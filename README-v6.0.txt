FRAGMENTS v6.0 — CLOUD READY

1. Backup your existing v5.3 folder before doing anything.
2. In Supabase: Project Settings → API, copy the anon/public publishable key.
3. Open cloud-config.js and replace the placeholder key.
4. Confirm site_sync has RLS enabled and policies restrict rows to auth.uid() = user_id.
5. Open the v6.0 site on the COMPUTER THAT CONTAINS YOUR REAL DATA.
6. Click “Connect & Sync” and sign in. Because site_sync is currently empty, v6.0 will upload the existing site:* localStorage data first.
7. Confirm rows appear in Supabase.
8. Deploy this v6.0 folder to GitHub Pages.
9. On phone, open the deployed site and sign in with the SAME account. It will download cloud data.

IMPORTANT: This first v6.0 package syncs all localStorage-based content (ToDo, Calendar preferences, Fragments, Inspo, Writing, Inbox, lyric, etc.). Visual Memory photos currently live in IndexedDB as Blob files and are intentionally NOT migrated by this package yet; those need a separate Supabase Storage migration to avoid uploading photos incorrectly or exposing them.

Do NOT delete your old v5.3 folder or clear browser data until you have verified the cloud copy.
