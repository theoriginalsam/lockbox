# Getting started

## 1. Install the extension

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Click the puzzle-piece icon in Chrome's toolbar and pin **Lockbox**.

Tabs that were already open don't have Lockbox yet. Refresh them once.

## 2. Create your vault

Click the Lockbox icon and choose a **master password**. Use a long passphrase: the strength bar
turns green at about 80 bits.

There is **no password reset**. Lockbox never stores or sends the master password, so nobody can
recover a forgotten one. Once you have saved a few things, export a backup (⚙ Settings → Backup).

Already using Lockbox on another computer? Choose **Connect to my synced vault** instead. See
[Sync](sync.md).

## 3. The popup at a glance

```
┌ Lockbox                    ● ⤢ ⚙ 🔒 ┐   ● sync status (green ok, red error) · ⤢ open in a tab
│ [ Fill application ] [ Work profile ]│   shown on job-application pages
│ (●) Badge  ( ) AI drafting  (●) Quiet Chrome
│ [ Search vault          ] [ + New ]  │
│  Logins   Notes   Profiles           │
│  G  github.com   alex               ⧉│   click a row to edit; ⧉ copies the password
└──────────────────────────────────────┘
```

The three switches on the front page:

| Switch | On means |
| --- | --- |
| **Badge** | A small Lockbox button appears in form fields when you click them. Turn it off to hide it everywhere. |
| **AI drafting** | Written-answer fields get a "Draft with AI" option. Needs an OpenRouter key first: see [Job applications](job-applications.md#ai-drafting). |
| **Quiet Chrome** | Chrome's own "Save password?" and address autofill stay off while Lockbox is unlocked. |

**⤢ Open in a tab** opens the same screens in a full browser tab, which is handier for editing many logins.

## 4. When it asks for the master password

By default Lockbox stays unlocked until **Chrome quits**. Reopening Chrome asks once. To lock
sooner, change **Settings → Lock** (15 minutes to 4 hours), or click the lock icon to lock immediately.

Reloading the extension in `chrome://extensions` also locks it. That's expected.

## Next

- Fill job applications: [Job applications](job-applications.md)
- Bring your passwords over from Chrome: [Passwords → Import](passwords.md#import-from-chrome-or-apple-passwords)
