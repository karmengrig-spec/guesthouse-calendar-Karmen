# Guesthouse Calendar — v3.1.4
- Cloud sync (Firestore) + local cache
- CSV export: **Month only** (All CSV hidden but code kept)
- iOS PWA safe-area + sticky header (month title)
- **Export Month** button: smaller, centered under title, scrolls away
- **Auto-expanding Note field** in booking modal

## Deploy (Vercel)
- Build command: `npm run build`
- Output dir: `build`
- Framework preset: Create React App
- Env vars: REACT_APP_FIREBASE_*

## iPhone install
Open in Safari → Share → **Add to Home Screen** → Add.
If UI looks cached, remove old icon and add again.
