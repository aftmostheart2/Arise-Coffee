# Arise Coffee

Coffee queue web app with Google Sheets backend.

## Features in this version

- Customer live order status: Waiting, Being Made, Ready, Complete
- Ready alert with vibration/sound where browser allows it
- Wait estimate using 3 minutes per order ahead
- Cleaner admin buttons: Start Making, Mark Ready, Complete
- Remote open/close queue through Google Apps Script
- Admin page at `/admin`
- PIN required on fresh admin visits
- Max 3 syrups
- Vercel route rewrite for `/admin`

## Vercel

- Framework: Vite
- Build command: `npm run build`
- Output folder: `dist`

## Apps Script

Use the Apps Script currently deployed for the Google Sheets backend.
