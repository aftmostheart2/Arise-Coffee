# Arise Coffee Proper Efficiency Patch

This patch starts from the stable working app and only makes safe efficiency changes.

## Changes

- Admin PIN uses fast Apps Script `login` action
- Admin PIN is required on each fresh admin visit
- Admin order refresh: 3 seconds
- Customer refresh: 6 seconds
- Keeps stable UI
- Keeps Arise Coffee branding
- Keeps max 3 syrups
- Keeps Vercel `/admin` rewrite

## Important

Use your current working Google Apps Script speed script.
Do not upload Apps Script txt files to GitHub unless you only want them as notes.
