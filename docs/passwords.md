# Passwords

## Saving a login

Sign in anywhere and Lockbox asks: **Save login for example.com? · Save / Not now / Never here**.

- It also works on sites that log you in without reloading the page (React and Next.js apps). It
  waits until the address changes or the password box goes away, so a failed login doesn't prompt.
- **Never here** adds the site to ⚙ Settings → **Never save on**. Remove it there to be asked again.
- If Lockbox is locked, the prompt says **Unlock Lockbox first, then press Save**.

## Filling a login

Click the username or password box, then the Lockbox badge, then the saved login. Or use the
popup's **Fill** button, or **⌘⇧L** / **Ctrl+Shift+L**.

Lockbox fills a login only on the **exact site** it was saved for. `github.com` won't fill on
`github.com.evil.io` or on a subdomain, and an https login never goes into an http page.

## When you change a password

On a change-password or reset page, Lockbox saves the **new** password: the box marked as a new
password, otherwise the last box (the new one or its confirmation), never "current password".
You'll see **Update saved password for example.com?**.

Reset pages often don't show your username. If you have exactly one login saved for that site,
Lockbox updates that one.

## When it misses one: save or edit it yourself

Click the Lockbox badge in any password box. The **Manage** section always offers:

- **Save the password typed here**: saves what's in the box right now (the new password on a
  change-password form).
- **Edit saved logins for this site**: opens Lockbox in a tab, already searched for this site.
  Click the login, change the password, then **Save changes**.

You can also open everything at any time: popup → **⤢** (open in a tab) → click any login to edit it.

## Quick passwords

The passwords you reuse, saved once and named by you ("Usual password 1", "Old work one").

- Add them in ⚙ Settings → **Quick passwords**.
- On a site with no saved login, click the password box, open the badge menu and pick one. The
  menu shows which site you're about to send it to, so only use it on the real site.
- On sign-up forms it fills the **confirm password** box too, but never "current password".
- After you sign in, the usual save prompt stores the login for that site.

## Import from Chrome or Apple Passwords

Extensions can't read Chrome's saved passwords, but Chrome can export them to a file.

**From Chrome**
1. Open `chrome://password-manager/settings`.
2. Click **Export passwords** → **Export**, and confirm with your Mac or Windows password. Chrome
   saves `Chrome Passwords.csv`.

**From Apple Passwords** (macOS Sequoia or later)
1. Open the **Passwords** app.
2. Choose **File → Export All Passwords…** and save the CSV.

**Into Lockbox**
1. Lockbox → ⚙ Settings → **Import passwords (CSV)** → choose the file.
2. Lockbox reports how many it imported. It skips logins it already has with the same password.
   When it already has a *different* password for the same site and username, it keeps its own
   version and tells you how many it kept. Android-app entries are skipped.
3. **Delete the CSV file and empty the Bin.** It contains every password in plain text.

Firefox exports work too (Passwords → ⋯ → Export Logins).

## Chrome's own password prompts

With **Quiet Chrome** on (popup front page), Chrome's own "Save password?" bubble and address
autofill stay off while Lockbox is unlocked, and come back when you lock it or turn the switch off.
If your organisation manages Chrome, Lockbox may not be allowed to change these settings; Settings
tells you when that's the case.
