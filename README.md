# Coffee Queue Admin Status Version

Backend URL already set:

https://script.google.com/macros/s/AKfycbzZondDOOrB3twVF7dScV02b4Mw2mrIEBf82g7BrcVLRmgBFjkt4uaWPlV27-PKq3Aymw/exec

## Important

Before deploying this Vercel version, replace your Apps Script code with the code in:

`APPS_SCRIPT_REPLACE_CODE.txt`

Then in Apps Script:

- Save
- Deploy
- Manage deployments
- Edit pencil
- New version
- Deploy

## Vercel

Upload this zip/folder to Vercel.

- Framework: Vite
- Build command: npm run build
- Output folder: dist

## Pages

- Customer page: `/`
- Admin page: `/admin`

## Admin features

- Open/close queue
- Change closed message
- See orders
- Set order status: Waiting, Start, Ready, Complete
- Clear completed orders
- Clear all orders only after queue is closed
- Cleared orders move to the Archive sheet


## Vercel route fix

This version includes `vercel.json` so `/admin` and all app routes load correctly on Vercel.


## Admin PIN behavior

This version does not remember the admin PIN in browser storage.
Each time `/admin` is opened fresh, the PIN screen appears again.

It also includes the Vercel rewrite for `/admin`.


## Closed badge CSS fix

This version fixes the queue closed header badge becoming a giant vertical panel.
The closed-screen CSS was renamed so it no longer collides with `.pill.closed`.
