# Lockbox

My personal password manager **and job-application filler**: a Chrome extension (Manifest V3)
with end-to-end encryption. It fills job applications from a full work profile, saves and fills
logins, keeps the two passwords I reuse one tap away, stores form profiles and secure notes,
and can sync its encrypted vault to my own site, samirpoudel.com.np.

## Tutorials

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, create the vault, the popup at a glance, when it asks for the master password |
| [Job applications](docs/job-applications.md) | Work profile and resume, **Fill application**, the tap-a-field menu, computed answers (age, DOB, 18+), AI drafting |
| [Passwords](docs/passwords.md) | Save prompts, password changes, quick passwords, manual save and edit, importing from Chrome or Apple Passwords |
| [Profiles](docs/profiles.md) | A *Personal* profile next to the work profile, JSON import, **Fill form** |
| [Sync](docs/sync.md) | Setting up the server on samirpoudel.com.np and connecting a second computer |
| [Troubleshooting](docs/troubleshooting.md) | Badge not showing, no save prompt, errors after reloading, what never to click |
| [Development](docs/development.md) | Tests, the dev harness, project layout, the vault format for the iPhone app |

## Features

- **Job applications:** one click fills everything Lockbox recognises (resume upload, yes/no and
  radio questions, EEO "decline"), outlines filled fields green and lists what still needs you.
  Tap any field for a searchable menu of your whole profile. Never submits.
- **Computed answers:** age, date of birth in whatever format the form wants, "Are you 18+?",
  age-range menus and today's date.
- **AI drafting (optional):** "Draft with AI" writes an answer to an open question from your
  profile and the job posting, through OpenRouter with your own key. It never invents facts.
- **Passwords:** save prompts that also work on single-page apps, updates when you change a
  password, two named quick passwords, CSV import from Chrome/Apple Passwords.
- **Chrome's own prompts off** while Lockbox is unlocked, so you don't get two "save password?" bubbles.
- **Sync** of the encrypted vault only; the server never sees a password.

## Security model

```
master password ──PBKDF2-SHA256, 600k iterations, random salt──► master key
master key ──HKDF "encryption"──► AES-256-GCM key   (never leaves the device)
master key ──HKDF "server-auth"──► sync token      (server stores only its SHA-256)
```

- The vault is one AES-GCM encrypted blob. The sync server stores ciphertext only: a breach of
  Vercel, Supabase or the site's code reveals nothing usable. WebCrypto primitives only.
- While unlocked, the key lives in `chrome.storage.session` (memory only). By default Lockbox
  asks for the master password again only after Chrome quits; a timed lock is in Settings.
- The in-page helper runs in Chrome's isolated world and draws its UI in a **closed** shadow
  root, so page scripts can't read your suggestions. Values are inserted only on a real
  (`isTrusted`) click, never by a page's synthetic events.
- Logins fill only on an **exact host match** (www. ignored): no subdomains, no look-alike
  domains, never an https login into an http page.
- Profile data is never filled into a form that contains a password field, and never into
  questions about someone else (referrer, emergency contact).
- Extension pages build their UI with DOM APIs and `textContent`; CSP `script-src 'self'`.
- **No recovery.** Forgetting the master password means the vault is gone. Keep an encrypted
  backup (Settings → Backup).

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `extension/` folder.
3. Pin Lockbox from the puzzle-piece menu, open it and create your vault.

Full walkthrough: [Getting started](docs/getting-started.md).

## Known limitations

- Logins inside cross-origin iframes (some banks) aren't filled.
- No master-password change yet (needs re-encryption plus a server-side rotation endpoint).
- Copied passwords aren't auto-cleared from the clipboard.
- Form profiles fill through the popup's **Fill form**; the tap-a-field menu offers logins and the work profile.
