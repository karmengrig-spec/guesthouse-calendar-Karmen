# Guesthouse Calendar — Cloud Sync + CSV + PWA (v3.1)

This is your working v3 with:
- **Optimistic Save/Cancel** (fixes buttons doing nothing on some devices).
- **Hybrid persistence**: local cache loads first; Firestore live updates merge in.
- **iOS PWA**: manifest + service worker so it runs as a standalone app when added to Home Screen.
- **CSV export** (All / Visible Month).

## Setup
1) Create Firebase project → Firestore database.
2) Copy `.env.sample` to `.env` and fill all `REACT_APP_FIREBASE_*` values.
3) `npm install`
4) `npm start` (local) or deploy to Vercel:
   - Build: `npm run build`
   - Output: `build`
   - Add same env vars in Vercel → Project → Settings → Environment Variables

## iPhone install
Open your site in Safari → **Share** → **Add to Home Screen** → **Add**.
Launch from the Home Screen icon to run in standalone mode.
