# Sync

Sync keeps the same vault on several computers, and later on the iPhone app. The server stores only
the **encrypted** vault plus the public key-derivation settings. It never sees your master password,
your encryption key, or any item.

```
Chrome (Lockbox) ──encrypted blob + auth token──► samirpoudel.com.np/api/lockbox ──► Supabase table lockbox_vault
```

The server code lives in the **samir-portfolio** repository (Next.js on Vercel), not in this repository.

## One-time server setup

1. **Database:** in Supabase → SQL editor, run `lockbox_schema.sql` from the samir-portfolio
   repository. It creates the `lockbox_vault` table with row-level security on and no policies,
   so only the server's service-role key can read it.
2. **Environment variables** (Vercel → Project → Settings → Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `LOCKBOX_ENROLL_TOKEN` | A long random string, e.g. the output of `openssl rand -base64 32`. You type it once into each new device. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Already set if the site uses Supabase |
   | `LOCKBOX_EXTENSION_ID` *(optional)* | Your extension's ID from `chrome://extensions`, to accept requests only from it |

3. **Deploy** the samir-portfolio branch that contains `src/app/api/lockbox/`.

## Turn sync on (first computer)

Lockbox → ⚙ Settings → **Sync**:

1. The server is pre-filled: `https://www.samirpoudel.com.np/api/lockbox`.
2. Paste your **enrollment code** (`LOCKBOX_ENROLL_TOKEN`).
3. Click **Turn on sync**. The dot in the header turns **green**.

From then on, every change uploads automatically.

## Add another computer

Install Lockbox ([Getting started](getting-started.md)), then choose **Connect to my synced vault**
instead of creating a new one. Enter the server, the enrollment code, and your **same master
password**.

## How conflicts are handled

Every item carries its own timestamp. When two devices changed the vault, they merge item by item
and the newer edit wins. Deletions are kept as markers, so an item deleted on one computer doesn't
come back from another. Uploads use compare-and-swap on a version number, so one device can never
silently overwrite another's newer upload.

## Turning it off

⚙ Settings → Sync → **Turn off** stops uploading. The copy on the server stays until you
delete the row in Supabase.
