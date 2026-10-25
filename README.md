# Arch Family — static GitHub Pages website

This repository contains only the website and the separate administration UI. It does **not** contain the Discord bot process or private server credentials. GitHub Pages serves the static files; Supabase provides the data/auth layer; the independent Discord bot writes member data and its status into Supabase.

## Layout

- `index.html`, `assets/` — public corkboard website
- `admin/` — settings dashboard
- `config.js` — Supabase project URL and **publishable** key, which are intentionally public
- `sql/001_github_static_site_security.sql` — RLS and grant migration for the static frontend
- `sql/002_verify_security.sql` — read-only checks after migration
- `.github/workflows/deploy-pages.yml` — deploys the repository to GitHub Pages on push to `main`

## First deployment

1. Create a GitHub repository and upload the contents of this folder to its root. Commit `config.js`; it contains only the public publishable key. Do not put Discord tokens or Supabase secret/service-role keys in this repository.
2. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Push to `main`; the workflow publishes the site automatically. Enable HTTPS.
3. In Supabase, make a database backup, review `sql/001_github_static_site_security.sql`, and run it in SQL Editor. This migration changes Data API permissions but does not delete family member rows. Do not skip it: browser security depends on its grants and RLS policies.
4. In Supabase **Authentication → URL Configuration**, add the eventual GitHub Pages URL to Site URL / Redirect URLs. For a project repository the URL usually includes `/<repository-name>/`; set the exact URL after choosing the repository name.
5. In Supabase Auth, create a dedicated administrator user with email/password. Confirm the email if your Auth settings require it.
6. Run this in the Supabase SQL Editor (replace the address with that account's email) to assign the **server-managed** `app_metadata` admin role:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
   where email = 'YOUR-ADMIN-EMAIL';
   ```

   Confirm that exactly one row was updated, then sign out and back in so the JWT contains the updated `app_metadata`. Do not use `user_metadata` for admin authorization. Open the site’s `admin/` path and sign in.
7. Run `sql/002_verify_security.sql`. Confirm the `anon` role cannot select Discord IDs or role IDs from `family_members`. The public key is not a secret; filtered view, RLS and column grants are the security boundary. The migration exposes only `id` and `is_active` from the base roster table to browser roles; public profile fields come through `site_family_members`, which honours the visibility toggles.
8. Deploy the Discord bot from the separate package `Arch_Family_Discord_Bot.zip`, set its private secrets in its host environment, and run `/family-sync` once.

## What's in the panel

Visual settings, board and card display, shared card layout, privacy toggles, typed relations, Discord role mapping, Supabase connection check, bot heartbeat, backups and restore of site settings/layout. Member roster creation and profile sync remain the Discord bot’s responsibility.

## Notes

- There is no Node.js backend on GitHub Pages. The browser uses Supabase’s publishable key and user session; all admin writes are constrained by RLS and `app_metadata.role = admin`.
- The bot must keep `SUPABASE_SERVICE_ROLE_KEY` and `DISCORD_BOT_TOKEN` private. Store them only as environment variables in the bot host, never in GitHub Pages/config.js.
- `integration_status` heartbeat appears after SQL migration and after the bot connects. The admin UI marks it offline if the last heartbeat is older than 90 seconds.
- An empty roster returned from Supabase is shown as empty; it does not fall back to local browser data.
- The GitHub workflow publishes static files, but it cannot run the Discord bot.
