# Lockbox 🔐

My personal password manager: a Chrome extension with end-to-end encryption, login autofill,
form profiles, secure notes, and (optionally) sync to my own site, samirpoudel.com.np.

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

`dev/harness.html` runs the real popup and background code against a mocked `chrome.*` and a
test site, so the whole flow (create, capture, save, fill, profiles, lock) can be exercised
without installing the extension. `dev/test-fixtures.json` holds fake values for it.

## Known limitations (v0.1)

- Logins inside iframes (some banks) aren't filled: top frame only, by design for now.
- No master-password change yet (needs re-encryption plus a server-side rotation endpoint).
- Copied passwords aren't auto-cleared from the clipboard.
- Sync API (`/api/vault` on samirpoudel.com.np) is a separate step.
