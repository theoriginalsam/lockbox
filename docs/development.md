# Development

No build step and no dependencies: plain ES modules that Chrome loads directly.

## Project layout

```
extension/
  manifest.json          MV3 manifest (content script on all pages, ES-module service worker)
  src/background.js      service worker: vault, messaging, autofill injection, Chrome prompt settings
  src/content.js         in-page helper: badge, menus, fill-all, save-login prompts (closed shadow DOM)
  src/crypto.js          PBKDF2 → HKDF → AES-256-GCM, via WebCrypto
  src/vault.js           item model, sanitising, site matching, merge, CSV import
  src/jobfields.js       field classifier for applications, computed answers
  src/autofill.js        functions injected to fill logins and form profiles
  src/ai.js              OpenRouter drafting (prompt + request)
  src/sync.js            client for /api/lockbox
  popup/                 toolbar popup (also opens as a full tab with ?page)
  profile/               work-profile editor
dev/                     harness that runs the real code against a mocked chrome.*
devsites/                fake sites: job application, login, sign-up/change password, SPA login
tests/                   node:test unit tests and a sync end-to-end test
SPEC.md                  vault and sync format, the contract for other clients (iPhone app)
```

## Tests

```bash
node --test tests/
```

These cover the crypto round-trip, vault sanitising and merging, site matching, CSV import, and the
application field classifier (name splitting, the someone-else guard, EEO decline, computed
answers). `tests/sync.e2e.mjs` runs against a local samir-portfolio dev server with
`LOCKBOX_STORE=memory`.

## Dev harness

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

Then open:

- `http://localhost:8766/dev/harness.html`: the real popup and background code side by side with
  a fake site running the real content script. Point the right-hand frame at any page in `devsites/`.
- `http://localhost:8766/dev/popup.html`: the popup alone.
- `http://localhost:8766/dev/profile.html`: the work-profile editor, seeded from
  `dev/test-fixtures.json`. Add `?fresh` for an empty profile.

All fixtures are **fake**. Never put real personal data in this repository; `my-profile.json` is
git-ignored for that reason.

## Debugging in real Chrome

- Service worker: `chrome://extensions` → Lockbox → *Inspect views: service worker*.
- Content script: the page's DevTools console. Lockbox logs only when its background can't answer.
- After editing code: **↻** on the Lockbox card, then refresh the test tab.

## Releasing a change

1. `node --test tests/`
2. Bump `version` in `extension/manifest.json`.
3. Update `SPEC.md` if the vault format changed. Other clients depend on it.
