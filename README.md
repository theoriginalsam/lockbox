# Lockbox 🔐

My personal password manager **and job-application filler**: a Chrome extension with end-to-end
encryption, login autofill, quick passwords, form profiles, secure notes, a full work profile
that fills job applications, and (optionally) sync to my own site, samirpoudel.com.np.

## Job applications

- **Work profile** (toolbar → Work profile): contact, experience, education, projects, skills,
  standard answers (authorization, sponsorship, salary, start date, EEO) and saved answers to
  custom questions, plus your resume PDF. Same schema as Nightshift's `profile.yaml`; import
  it with `nightshift export-lockbox > profile.json`.
- **Fill everything:** `⌘/Ctrl+Shift+Y`, toolbar → Fill application, or the blue button on
  application pages. Fills what it recognises (including the resume upload, yes/no and
  radio questions, EEO "decline"), outlines filled fields green, lists what still needs you.
  Never submits.
- **Tap a field:** a Lockbox badge appears on form fields; on application pages the menu opens
  by itself with the best match starred and your whole profile searchable. `Alt+↓` opens it too.
- Never puts your details into questions about someone else (referrer, emergency contact …).

## Quick passwords

Save the passwords you reuse (Settings → Quick passwords). On a site with no saved login, tap
the password field to try them; the menu shows which site you're sending one to. After you
sign in, Lockbox offers **Save / Not now / Never here**.

## Security model

```
master password ──PBKDF2-SHA256, 600k iterations, random salt──► master key
master key ──HKDF "encryption"──► AES-256-GCM key   (never leaves the device)
master key ──HKDF "server-auth"──► sync token      (server stores only its SHA-256)
```

- The vault is one AES-GCM encrypted blob. The sync server stores ciphertext only: a breach of
  Vercel, Supabase or the site's code reveals nothing usable.
- WebCrypto primitives only. No homemade cryptography.
- While unlocked, the key lives in `chrome.storage.session` (memory only, cleared on browser
  restart). Auto-lock after inactivity (default 15 min).
- Autofill runs only when I click **Fill** or press **⌘/Ctrl+Shift+L** (`activeTab`): no script is
  injected into every page. Logins fill only on an **exact host match** (www. ignored): no
  subdomains, no look-alike domains, never an https login into an http page, top frame only.
- Profile data is never filled into a form that contains a password field.
- The popup builds its UI with `textContent` only, so a hostile site name can't inject script.
- **No recovery.** Forgetting the master password means the vault is gone. Keep an encrypted
  backup (Settings → Export).

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `extension/` folder.
3. Pin Lockbox from the puzzle-piece menu, open it, and create your vault.

## Develop

```bash
node --test tests/                       # crypto + vault unit tests
python3 -m http.server 8099              # then open http://localhost:8099/dev/harness.html
```

`dev/harness.html` runs the real popup and background code against a mocked `chrome.*`, with
fake sites in `devsites/` (a Greenhouse-style application and a login page) running the real
content script; `dev/profile.html` renders the work-profile editor. `dev/test-fixtures.json`
holds fake values for all of it. Vault/sync format for other clients (iPhone app): `SPEC.md`.

## Known limitations (v0.1)

- Logins inside iframes (some banks) aren't filled: top frame only, by design for now.
- No master-password change yet (needs re-encryption plus a server-side rotation endpoint).
- Copied passwords aren't auto-cleared from the clipboard.
- Sync API lives in the samir-portfolio repo at `/api/lockbox` (see `lockbox_schema.sql` there).
