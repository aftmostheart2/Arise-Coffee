Arise Coffee Supabase Stage 2

Upload these files to your supabase-v2 branch.

Important:
- This does NOT edit main.jsx.
- Your app will continue using Google Sheets until main.jsx imports src/api/backend.js.
- backend.js is set to BACKEND = "sheets".
- Supabase code is present but not enabled yet.

After uploading:
1. Make sure package.json includes @supabase/supabase-js.
2. Add Vercel environment variables later:
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY
3. Do not put the Supabase service_role key in Vercel or React.
