# Troubleshooting

## The Lockbox badge doesn't appear in fields

Work through these in order:

1. **Is the Badge switch on?** Popup front page → **Badge** should be green. If it was turned off,
   Lockbox deliberately stays out of every field.
2. **Refresh the page.** Tabs that were open before you installed, updated or reloaded Lockbox don't
   have it yet. The popup warns you on such a page and offers **Refresh page**.
3. **Site access.** `chrome://extensions` → Lockbox → **Details** → *Site access* should be **On all sites**.
4. **Is it the right kind of field?** Search boxes are skipped on purpose.

## It didn't offer to save my password

- Use the manual fallback: click the badge in the password box → **Save the password typed here**.
- Did you choose **Never here** before? Check ⚙ Settings → **Never save on** and remove the site.
- If the login failed, Lockbox doesn't ask. That's on purpose.
- Some sites sign you in inside an embedded frame from another domain. Save it manually as above,
  or add it in the popup with **+ New**.

## It saved the wrong password, or didn't update after I changed it

Click the badge in the password box → **Edit saved logins for this site**, then fix the login in
the tab that opens. See [Passwords → When it misses one](passwords.md#when-it-misses-one-save-or-edit-it-yourself).

## "Errors" on the Lockbox card in chrome://extensions

After Lockbox is reloaded or updated, scripts left in already-open tabs lose their connection to
it. Refreshing those tabs fixes it. Click **Clear all** on the Errors page. If errors keep coming
back after a refresh, open the service worker console (Details → *Inspect views: service worker*)
and note the message.

## "unknown item type …" or a new feature missing

Chrome is still running the old version. In `chrome://extensions`, click **↻** on the Lockbox card,
then refresh your tabs. Reloading locks the vault; unlock it again.

## It asks for the master password more often than I want

⚙ Settings → **Lock** → *When I quit Chrome*. Reloading the extension always locks it.

## Never click "Remove"

**Remove** on the Lockbox card in `chrome://extensions` deletes the extension **and your vault**.
Use **↻ reload** to update. If you ever need to reinstall, export a backup first
(⚙ Settings → Backup), or make sure sync is on.

## I forgot my master password

It can't be recovered. That's the point of end-to-end encryption. With an encrypted backup or sync
you still need the same master password. Without it, use ⚙ Settings → Danger zone → *Delete vault*
and start again.
