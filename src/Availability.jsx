import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, isSameMonth, format, startOfDay, isBefore, isAfter, parseISO
} from "date-fns";
import { db } from "./firebase";
import { collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { backupJSON, loadBackupJSON } from "./drive";

const roomsSeed = [
  { id: "r1", name: "Double Room" },
  { id: "r2", name: "Double or Twin Room" },
  { id: "r3", name: "Standard Double Room" },
  { id: "r4", name: "Deluxe Double Room" },
  { id: "r5", name: "Family Room with Balcony" },
  { id: "r6", name: "Cottage in the Garden" },
  { id: "r7", name: "Sauna" },
];

const bookedCell = "relative bg-red-200 text-red-900 after:content-[''] after:absolute after:inset-0 after:bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.08)_6px,rgba(0,0,0,0.08)_12px)]";
const freeCell   = "bg-emerald-100 text-emerald-900";

function isBookedOn(day, roomId, bookings){
  return bookings.some(b => b.roomId===roomId && isBefore(new Date(b.start), addDays(day,1)) && isAfter(new Date(b.end), day));
}
function formatISODate(d){
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function RoomMonth({ room, month, bookings, onTapFree, onTapBooked, isAdmin }){
  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
  const days = React.useMemo(()=>{ const arr=[]; let d=gridStart; while(d<=gridEnd){ arr.push(d); d=addDays(d,1); } return arr; }, [month]);

  return (
    <div className="mb-6">
      <div className="grid grid-cols-7 text-[11px] text-slate-500 px-1 pb-1">{['M','T','W','T','F','S','S'].map((d)=>(<div key={d} className="text-center">{d}</div>))}</div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, idx) => {
          const inMonth = isSameMonth(d, monthStart);
          const booked = inMonth && isBookedOn(d, room.id, bookings);
          const free = inMonth && !booked;
          const prev = addDays(d,-1), next = addDays(d,1);
          const prevIn = isSameMonth(prev, monthStart), nextIn = isSameMonth(next, monthStart);
          const prevBooked = prevIn && isBookedOn(prev, room.id, bookings);
          const nextBooked = nextIn && isBookedOn(next, room.id, bookings);
          const prevFree = prevIn && !prevBooked;
          const nextFree = nextIn && !nextBooked;

          const base = "h-7 flex items-center justify-center text-xs relative rounded-full";
          let cls = "";
          if (!inMonth) cls = "text-slate-300";
          else if (booked){ const left = !prevBooked, right = !nextBooked; cls = `${bookedCell} ${left?'rounded-l-full pl-2':''} ${right?'rounded-r-full pr-2':''}`; }
          else if (free){ const left = !prevFree, right = !nextFree; cls = `${freeCell} ${left?'rounded-l-full pl-2':''} ${right?'rounded-r-full pr-2':''}`; }

          return (
            <button
              key={idx}
              type="button"
              className={`${base} ${cls}`}
              onClick={() => {
                if (free) {
                  if (isAdmin) onTapFree(room.id, d);
                } else {
                  onTapBooked(room.id, d); // everyone can view booked details
                }
              }}
            >
              {format(d,'d')}
            </button>
          );
        })}
      </div>
      <div className="mt-2 px-1 text-sm font-semibold">{room.name}</div>
    </div>
  );
}

function useDebounce(fn, delay=1200){
  const t = React.useRef(null);
  const debounced = (...args) => {
    clearTimeout(t.current);
    t.current = setTimeout(()=>fn(...args), delay);
  };
  return debounced;
}

export default function Availability({ isAdmin }){
  const [rooms] = useState(roomsSeed);
  const [bookings, setBookings] = useState([]);
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [syncError, setSyncError] = useState(null);
  const CACHE_KEY = "ghc_cloud_cache_v1";
  const BACKUP_FILE = "greenstone_bookings_backup.json";
  const debouncedBackup = useDebounce(async (data)=>{
    try{ await backupJSON(BACKUP_FILE, data); }catch(e){}
  }, 1500);

  useEffect(() => { try { const raw = localStorage.getItem(CACHE_KEY); if (raw) setBookings(JSON.parse(raw)); } catch {} }, []);
  useEffect(()=>{
    const coll = collection(db, "bookings");
    const unsub = onSnapshot(coll, (snap)=>{
      const cloud = []; snap.forEach(docSnap => cloud.push({ id: docSnap.id, ...docSnap.data() }));
      setBookings(prev => {
        const byId = new Map(prev.map(b => [b.id, b]));
        for(const c of cloud) byId.set(c.id, c);
        const merged = Array.from(byId.values());
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch {}
        return merged;
      });
      setSyncError(null);
    }, (err) => setSyncError(err?.message || "Live sync unavailable"));
    return () => unsub();
  }, []);

  const roomNameById = useMemo(() => Object.fromEntries(rooms.map(r => [r.id, r.name])), [rooms]);

  function toCSV(rows) {
    const headers = ["roomId","roomName","guest","note","start","end","nights"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))];
    return "\uFEFF" + lines.join("\r\n");
  }
  function exportVisibleMonthCSV() {
    const monthStart = startOfMonth(month), monthEnd = endOfMonth(month);
    const rows = bookings.filter(b => new Date(b.start) < monthEnd && new Date(b.end) > monthStart).map(b => {
      const s = new Date(b.start), e = new Date(b.end);
      const nights = Math.max(0, Math.round((e - s) / 86400000));
      return { roomId:b.roomId, roomName:roomNameById[b.roomId]||"", guest:b.guest||"", note:b.note||"", start:format(s,"yyyy-MM-dd"), end:format(e,"yyyy-MM-dd"), nights };
    });
    const csv = toCSV(rows), blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
    a.download = `bookings_${format(month,"yyyy_MM")}_${format(new Date(),"HH-mm")}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const [modal, setModal] = useState({ open:false, mode:"create", readOnly:false, roomId:null, bookingId:null, start:"", end:"", guest:"", note:"" });
  const noteRef = useRef(null);
  useEffect(()=>{ if (noteRef.current) { noteRef.current.style.height = "auto"; noteRef.current.style.height = noteRef.current.scrollHeight + "px"; } }, [modal.open]);

  function openCreate(roomId, day){
    if(!isAdmin) return;
    setModal({ open:true, mode:"create", readOnly:false, roomId, bookingId:null, start: formatISODate(day), end: formatISODate(addDays(day,1)), guest:"", note:"" });
  }
  function openEdit(roomId, day){
    const b = bookings.find(bk => bk.roomId===roomId && isBefore(new Date(bk.start), addDays(day,1)) && isAfter(new Date(bk.end), day));
    if(!b) return;
    setModal({ open:true, mode:"edit", readOnly: !isAdmin, roomId, bookingId:b.id, start: formatISODate(new Date(b.start)), end: formatISODate(new Date(b.end)), guest: b.guest||"", note: b.note||"" });
  }
  function overlapsRange(roomId, s, e, ignoreId=null){
    return bookings.some(b => b.roomId===roomId && b.id!==ignoreId && (s < new Date(b.end) && e > new Date(b.start)));
  }

  async function saveModal(){
    if(!isAdmin) return;
    const s = startOfDay(parseISO(modal.start));
    const e = startOfDay(parseISO(modal.end));
    if(!(e > s)){ alert("End date must be after start date."); return; }
    if (overlapsRange(modal.roomId, s, e, modal.mode==="edit" ? modal.bookingId : null)){ alert("These dates overlap an existing booking."); return; }
    setModal(m => ({...m, open:false}));
    if(modal.mode==="create"){
      const tempId = "local_" + Date.now();
      const newBk = { id: tempId, roomId: modal.roomId, guest: modal.guest || "Guest", note: modal.note || "", start: s.toISOString(), end: e.toISOString() };
      setBookings(prev => { const arr=[...prev, newBk]; try{ localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); }catch{} try{ debouncedBackup(arr); }catch{} return arr; });
      try {
        const ref = await addDoc(collection(db, "bookings"), { roomId:newBk.roomId, guest:newBk.guest, note:newBk.note, start:newBk.start, end:newBk.end, createdAt: serverTimestamp() });
        setBookings(prev => { const arr=prev.map(b => b.id===tempId ? { ...newBk, id: ref.id } : b); try{ localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); }catch{} try{ debouncedBackup(arr); }catch{} return arr; });
      } catch (err) { /* keep local */ }
    } else {
      const edited = { id: modal.bookingId, roomId: modal.roomId, guest: modal.guest || "Guest", note: modal.note || "", start: s.toISOString(), end: e.toISOString() };
      setBookings(prev => { const arr=prev.map(b => b.id===edited.id ? edited : b); try{ localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); }catch{} try{ debouncedBackup(arr); }catch{} return arr; });
      try { if (!String(edited.id).startsWith("local_")){ await updateDoc(doc(db, "bookings", edited.id), { guest: edited.guest, note: edited.note, start: edited.start, end: edited.end }); } }
      catch (err) {}
    }
  }

  async function cancelBooking(){
    if(!isAdmin) return;
    if(!modal.bookingId) return;
    const id = modal.bookingId;
    setModal(m=> ({...m, open:false}));
    setBookings(prev => { const arr=prev.filter(b => b.id !== id); try{ localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); }catch{} try{ debouncedBackup(arr); }catch{} return arr; });
    try { if (!String(id).startsWith("local_")) { await deleteDoc(doc(db, "bookings", id)); } }
    catch (err) {}
  }

  return (
    <div className="w-full max-w-md mx-auto p-3 pb-28">
      <div className="flex items-center justify-between mb-1 header-sticky">
        <button type="button" aria-label="Previous month" className="px-3 py-2 rounded-xl border border-transparent" onClick={()=> setMonth(m=> subMonths(m,1))}>‹</button>
        <div className="text-lg font-semibold">{format(month, "LLLL yyyy")}</div>
        <button type="button" aria-label="Next month" className="px-3 py-2 rounded-xl border border-transparent" onClick={()=> setMonth(m=> addMonths(m,1))}>›</button>
      </div>
      <div className="flex justify-center mb-2">
        <button type="button" className="mt-1 px-3 py-1 text-xs rounded-lg border bg-white shadow-sm" onClick={exportVisibleMonthCSV}>
          Export Month
        </button>
        <button type="button" className="mt-1 ml-2 px-3 py-1 text-xs rounded-lg border bg-white shadow-sm"
          onClick={() => backupJSON("greenstone_bookings_backup.json", bookings)}>
          Backup Now
        </button>
        <button type="button" className="mt-1 ml-2 px-3 py-1 text-xs rounded-lg border bg-white shadow-sm"
          onClick={async ()=>{
            try{
              const data = await loadBackupJSON("greenstone_bookings_backup.json");
              if (data && Array.isArray(data)) {
                setBookings(data);
                try{ localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }catch{}
              } else { alert("No backup found."); }
            } catch { alert("Restore failed."); }
          }}>
          Restore
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
        <div className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span> Available</div>
        <div className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500"></span> Booked</div>
      </div>
      <div className="bg-white rounded-2xl shadow border p-3">
        <div className="grid grid-cols-2 gap-x-6">
          {rooms.map(room => (
            <RoomMonth key={room.id} room={room} month={month} bookings={bookings} onTapFree={openCreate} onTapBooked={openEdit} isAdmin={isAdmin} />
          ))}
        </div>
      </div>
      {modal.open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={()=> setModal(m=> ({...m, open:false}))} />
          <div className="absolute inset-x-4 bottom-6 max-w-md mx-auto bg-white rounded-2xl shadow-lg border p-4">
            <div className="text-sm font-semibold mb-2">{modal.mode==="create" ? "Add Booking" : (modal.readOnly ? "Booking Details (read-only)" : "Booking Details")}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Start</span>
                <input type="date" value={modal.start} onChange={e=> setModal(m=> ({...m, start:e.target.value}))} className="border rounded-lg px-2 py-1" disabled={modal.readOnly} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">End</span>
                <input type="date" value={modal.end} onChange={e=> setModal(m=> ({...m, end:e.target.value}))} className="border rounded-lg px-2 py-1" disabled={modal.readOnly} />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-xs text-slate-500">Guest name</span>
                <input type="text" value={modal.guest} onChange={e=> setModal(m=> ({...m, guest:e.target.value}))} placeholder="Guest" className="border rounded-lg px-2 py-1" disabled={modal.readOnly} />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-xs text-slate-500">Note (optional)</span>
                <textarea
                  ref={noteRef}
                  value={modal.note}
                  onChange={(e)=>{
                    setModal(m=> ({...m, note:e.target.value}));
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  placeholder="e.g. Paid cash, 2 adults, arriving 9pm, vegetarian breakfast"
                  className="border rounded-lg px-2 py-2 w-full resize-none leading-relaxed overflow-hidden"
                  rows={3}
                  disabled={modal.readOnly}
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between">
              {(modal.mode==="edit" && !modal.readOnly) ? (
                <button type="button" onClick={async ()=>{
                  const id = modal.bookingId;
                  setModal(m=> ({...m, open:false}));
                  setBookings(prev => { const arr=prev.filter(b => b.id !== id); try{ localStorage.setItem(CACHE_KEY, JSON.stringify(arr)); }catch{} try{ debouncedBackup(arr); }catch{} return arr; });
                  try { if (!String(id).startsWith("local_")) { await deleteDoc(doc(db, "bookings", id)); } }
                  catch (err) {}
                }} className="px-3 py-2 rounded-xl border text-red-600 border-red-300">Cancel booking</button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={()=> setModal(m=> ({...m, open:false}))} className="px-3 py-2 rounded-xl border">Close</button>
                {(!modal.readOnly) && (
                  <button type="button" onClick={saveModal} className="px-3 py-2 rounded-xl border bg-emerald-600 text-white">Save</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
