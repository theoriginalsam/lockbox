// Lockbox service worker: the only place the vault is decrypted.
//
// chrome.storage.local    sealed (encrypted) vault + settings, persisted to disk
// chrome.storage.session  the AES key + sync token while unlocked: memory only, cleared on
//                         browser restart, readable only by extension pages
// The popup asks for actions by message; autofill code is injected only on explicit user action.

import { fillLoginInPage, fillProfileInPage, readLoginInPage } from "./autofill.js";
import {
  decryptJSON, deriveKeys, encryptJSON, exportKey, importKey, newKdfParams, openVault, passwordStrength, sealVault,
} from "./crypto.js";
import { classify, emptyProfile, normalizeProfile, profileFacts, suggest } from "./jobfields.js";
import * as sync from "./sync.js";
import { deleteItem, emptyVault, liveItems, matchesSite, mergeVaults, upsertItem } from "./vault.js";

const LOCAL_KEY = "lockbox";
const SESSION_KEY = "lockboxSession";
const FILES_KEY = "lockboxFiles";          // encrypted resume PDF (device-local, not synced yet)
const PENDING_KEY = "lockboxPendingSave";  // session: logins waiting for a "save?" answer, per tab
const DEFAULT_SETTINGS = {
  autoLockMinutes: 15,
  inlineHelper: true,
  neverSave: [],
  sync: { enabled: false, apiBase: sync.DEFAULT_API, version: 0, lastSyncAt: null, lastError: null },
};

// ---------------------------------------------------------------- storage helpers

async function loadLocal() {
  const stored = (await chrome.storage.local.get(LOCAL_KEY))[LOCAL_KEY];
  if (!stored) return null;
  return { ...stored, settings: { ...DEFAULT_SETTINGS, ...stored.settings,
    sync: { ...DEFAULT_SETTINGS.sync, ...stored.settings?.sync } } };
}

async function saveLocal(local) {
  await chrome.storage.local.set({ [LOCAL_KEY]: local });
}

async function getSession() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || null;
}

async function startSession(encKey, authToken, minutes) {
  await chrome.storage.session.set({ [SESSION_KEY]: { key: await exportKey(encKey), authToken } });
  await armAutoLock(minutes);
}

async function armAutoLock(minutes) {
  await chrome.alarms.create("autolock", { delayInMinutes: Math.max(1, minutes) });
}

async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms.clear("autolock");
}

/** Decrypted vault + key material, or throws "locked". */
async function unlocked() {
  const [local, session] = await Promise.all([loadLocal(), getSession()]);
  if (!local || !session) throw new Error("locked");
  const key = await importKey(session.key);
  const vault = await decryptJSON(local.sealed.box, key);
  await armAutoLock(local.settings.autoLockMinutes);   // activity resets the timer
  return { local, session, key, vault };
}

async function persist(ctx, vault) {
  ctx.local.sealed = await sealVault(vault, ctx.key, ctx.local.sealed.kdf);
  await saveLocal(ctx.local);
  if (ctx.local.settings.sync.enabled) syncSoon();
}

// ---------------------------------------------------------------- tabs

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function inject(tab, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return result?.result;
}

// ---------------------------------------------------------------- sync

let syncTimer = null;
function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), 1500);
}

async function recordSync(local, patch) {
  local.settings.sync = { ...local.settings.sync, ...patch };
  await saveLocal(local);
}

async function syncNow() {
  const ctx = await unlocked();
  const s = ctx.local.settings.sync;
  if (!s.enabled) return { skipped: true };
  try {
    let { sealed: remoteSealed, version } = await sync.pull(s.apiBase, ctx.session.authToken);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (remoteSealed.kdf.salt !== ctx.local.sealed.kdf.salt) {
        throw new sync.SyncError("The server holds a vault with a different master password");
      }
      const remote = await decryptJSON(remoteSealed.box, ctx.key);
      const merged = mergeVaults(ctx.vault, remote);
      ctx.vault = merged;
      const sealed = await sealVault(merged, ctx.key, ctx.local.sealed.kdf);
      if (JSON.stringify(merged) === JSON.stringify(mergeVaults(remote, remote))) {
        ctx.local.sealed = sealed;                     // server already has everything
        await recordSync(ctx.local, { version, lastSyncAt: Date.now(), lastError: null });
        return { version, pushed: false };
      }
      const res = await sync.push(s.apiBase, ctx.session.authToken, sealed, version);
      if (res.ok) {
        ctx.local.sealed = sealed;
        await recordSync(ctx.local, { version: res.version, lastSyncAt: Date.now(), lastError: null });
        return { version: res.version, pushed: true };
      }
      ({ sealed: remoteSealed, version } = res);       // someone pushed first: merge again
    }
    throw new sync.SyncError("Sync kept conflicting; try again");
  } catch (err) {
    await recordSync(ctx.local, { lastError: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------- message handlers

const handlers = {
  async state() {
    const [local, session, tab] = await Promise.all([loadLocal(), getSession(), activeTab()]);
    return {
      status: !local ? "setup" : session ? "unlocked" : "locked",
      settings: local?.settings || DEFAULT_SETTINGS,
      tab: tab?.url ? { url: tab.url, host: safeHost(tab.url) } : null,
    };
  },

  async create({ password }) {
    if (await loadLocal()) throw new Error("A vault already exists");
    if (passwordStrength(password).bits < 50) throw new Error("Choose a longer master password");
    const kdf = newKdfParams();
    const { encKey, authToken } = await deriveKeys(password, kdf);
    const local = { sealed: await sealVault(emptyVault(), encKey, kdf), settings: DEFAULT_SETTINGS };
    await saveLocal(local);
    await startSession(encKey, authToken, local.settings.autoLockMinutes);
    return { ok: true };
  },

  async connect({ apiBase, password }) {
    if (await loadLocal()) throw new Error("A vault already exists on this device");
    const kdf = await sync.fetchParams(apiBase);
    if (!kdf) throw new Error("No vault has been set up on that server yet");
    const { encKey, authToken } = await deriveKeys(password, kdf);
    const { sealed, version } = await sync.pull(apiBase, authToken);
    await decryptJSON(sealed.box, encKey);               // proves the password before saving anything
    const settings = { ...DEFAULT_SETTINGS, sync: { ...DEFAULT_SETTINGS.sync, enabled: true, apiBase, version,
      lastSyncAt: Date.now() } };
    await saveLocal({ sealed, settings });
    await startSession(encKey, authToken, settings.autoLockMinutes);
    return { ok: true };
  },

  async unlock({ password }) {
    const local = await loadLocal();
    if (!local) throw new Error("No vault yet");
    const { encKey, authToken } = await openVault(local.sealed, password);   // throws on wrong password
    await startSession(encKey, authToken, local.settings.autoLockMinutes);
    if (local.settings.sync.enabled) syncSoon();
    return { ok: true };
  },

  async lock() {
    await lock();
    return { ok: true };
  },

  async list() {
    const { vault } = await unlocked();
    const tab = await activeTab();
    const items = liveItems(vault).sort((a, b) => a.name.localeCompare(b.name));
    return { items, matches: tab?.url ? items.filter((i) => matchesSite(i, tab.url)).map((i) => i.id) : [] };
  },

  async save({ item }) {
    const ctx = await unlocked();
    const { vault, item: saved } = upsertItem(ctx.vault, item);
    await persist(ctx, vault);
    return { item: saved };
  },

  async remove({ id }) {
    const ctx = await unlocked();
    await persist(ctx, deleteItem(ctx.vault, id));
    return { ok: true };
  },

  async fill({ id }) {
    const { vault } = await unlocked();
    const item = liveItems(vault).find((i) => i.id === id);
    const tab = await activeTab();
    if (!item || !tab) throw new Error("Nothing to fill");
    if (!matchesSite(item, tab.url)) throw new Error(`This login is for ${safeHost(item.url)}, not ${safeHost(tab.url)}`);
    const res = await inject(tab, fillLoginInPage, [item.username, item.password]);
    if (!res?.filled) throw new Error("No login form found on this page");
    return res;
  },

  async fillProfile({ id }) {
    const { vault } = await unlocked();
    const item = liveItems(vault).find((i) => i.id === id && i.type === "profile");
    const tab = await activeTab();
    if (!item || !tab || !/^https?:/.test(tab.url || "")) throw new Error("Open the form you want to fill first");
    const res = await inject(tab, fillProfileInPage, [item.fields]);
    if (!res?.filled) throw new Error("No matching form fields found");
    return res;
  },

  async capture() {
    await unlocked();
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("Open the login page first");
    return inject(tab, readLoginInPage);
  },

  async settings({ patch }) {
    const ctx = await unlocked();
    const minutes = Number(patch.autoLockMinutes);
    if (Number.isFinite(minutes)) ctx.local.settings.autoLockMinutes = Math.min(240, Math.max(1, minutes));
    if (typeof patch.inlineHelper === "boolean") ctx.local.settings.inlineHelper = patch.inlineHelper;
    if (Array.isArray(patch.neverSave)) ctx.local.settings.neverSave = patch.neverSave.map(String);
    await saveLocal(ctx.local);
    return { settings: ctx.local.settings };
  },

  async enableSync({ apiBase, enrollToken }) {
    const ctx = await unlocked();
    const base = apiBase || sync.DEFAULT_API;
    const existing = await sync.fetchParams(base);
    let version;
    if (existing) {
      if (existing.salt !== ctx.local.sealed.kdf.salt) {
        throw new Error("That server already holds a different vault. Use 'Connect' on a fresh install instead.");
      }
      version = 0;                                   // same vault: first sync will merge
    } else {
      version = await sync.enroll(base, { enrollToken, authToken: ctx.session.authToken, sealed: ctx.local.sealed });
    }
    await recordSync(ctx.local, { enabled: true, apiBase: base, version, lastError: null });
    return syncNow();
  },

  async disableSync() {
    const ctx = await unlocked();
    await recordSync(ctx.local, { enabled: false });
    return { ok: true };
  },

  syncNow,

  // ---------------------------------------------------------------- work profile & quick passwords

  async jobProfileGet() {
    const { vault } = await unlocked();
    const item = liveItems(vault).find((i) => i.type === "job");
    const files = (await chrome.storage.local.get(FILES_KEY))[FILES_KEY] || {};
    return { id: item?.id || null, profile: item?.profile || emptyProfile(),
      resume: files.resume ? { name: files.resume.name, size: files.resume.size } : null };
  },

  async jobProfileSave({ profile }) {
    const ctx = await unlocked();
    const existing = liveItems(ctx.vault).find((i) => i.type === "job");
    const { vault } = upsertItem(ctx.vault, { id: existing?.id, type: "job", name: "Work profile",
      profile: normalizeProfile(profile) });
    await persist(ctx, vault);
    return { ok: true };
  },

  async resumeUpload({ name, mime, b64 }) {
    const { key } = await unlocked();
    if (mime !== "application/pdf" && !/\.(pdf|docx?)$/i.test(name)) throw new Error("Upload a PDF or Word file");
    if (b64.length > 7_000_000) throw new Error("Resume must be under 5 MB");
    const box = await encryptJSON({ name, type: mime || "application/pdf", b64 }, key);
    await chrome.storage.local.set({ [FILES_KEY]: { resume: { name, size: Math.round(b64.length * 0.75), box } } });
    return { ok: true };
  },

  async resumeRemove() {
    await unlocked();
    await chrome.storage.local.remove(FILES_KEY);
    return { ok: true };
  },

  async fillApplication() {
    await unlocked();
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("Open the job application first");
    return chrome.tabs.sendMessage(tab.id, { type: "lockbox:fillAll" });
  },

  async exportBackup() {
    const { local } = await unlocked();
    return { filename: `lockbox-backup-${new Date().toISOString().slice(0, 10)}.json`, data: local.sealed };
  },

  async wipe({ confirm }) {
    if (confirm !== "DELETE") throw new Error("Type DELETE to confirm");
    await lock();
    await chrome.storage.local.remove(LOCAL_KEY);
    return { ok: true };
  },
};

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- in-page helper (content script)
//
// The content script runs on every page, so this channel is deliberately narrow: it never lists
// the vault, only returns logins whose saved site matches the *frame* asking, and job/profile
// data only while unlocked. Quick passwords are released one at a time, on the user's tap.

async function resumeFile(key) {
  const files = (await chrome.storage.local.get(FILES_KEY))[FILES_KEY];
  return files?.resume ? decryptJSON(files.resume.box, key) : null;
}

function jobProfileOf(vault) {
  return liveItems(vault).find((i) => i.type === "job")?.profile || null;
}

async function getPending() {
  return (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] || {};
}

async function setPending(pending) {
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
}

const contentHandlers = {
  async status(_msg, sender) {
    const local = await loadLocal();
    const session = await getSession();
    if (!local) return { setup: false };
    if (!session) return { setup: true, unlocked: false, inline: local.settings.inlineHelper };
    const { vault } = await unlocked();
    const items = liveItems(vault);
    return {
      setup: true, unlocked: true, inline: local.settings.inlineHelper,
      hasProfile: items.some((i) => i.type === "job"),
      quickCount: items.filter((i) => i.type === "quick").length,
      siteLogins: items.filter((i) => matchesSite(i, sender.url)).length,
    };
  },

  async suggest({ field }, sender) {
    const ctx = await unlocked().catch(() => null);
    if (!ctx) return { locked: true };
    const items = liveItems(ctx.vault);
    if (field.type === "password" || /user|login|email/i.test(`${field.autocomplete} ${field.name} ${field.id}`)
        && items.some((i) => matchesSite(i, sender.url))) {
      const logins = items.filter((i) => matchesSite(i, sender.url))
        .map((i) => ({ id: i.id, name: i.name, username: i.username }));
      const quick = field.type === "password"
        ? items.filter((i) => i.type === "quick").map((i) => ({ id: i.id, name: i.name })) : [];
      if (logins.length || quick.length || field.type === "password") return { kind: "login", logins, quick, host: safeHost(sender.url) };
    }
    const profile = jobProfileOf(ctx.vault);
    if (!profile) return { kind: "job", empty: true };
    return { kind: "job", suggestions: suggest(field, profile), facts: profileFacts(profile) };
  },

  async login({ id }, sender) {
    const { vault } = await unlocked();
    const item = liveItems(vault).find((i) => i.id === id && i.type === "login");
    if (!item || !matchesSite(item, sender.url)) throw new Error("That login isn't for this site");
    return { username: item.username, password: item.password };
  },

  async quick({ id }) {
    const { vault } = await unlocked();
    const item = liveItems(vault).find((i) => i.id === id && i.type === "quick");
    if (!item) throw new Error("Quick password not found");
    return { password: item.password };
  },

  async plan({ fields }) {
    const ctx = await unlocked();
    const profile = jobProfileOf(ctx.vault);
    if (!profile) throw new Error("Add your work profile in Lockbox first");
    const values = [];
    let needsResume = false;
    for (const f of fields) {
      const r = classify(f, profile);
      if (r) {
        values.push({ index: f.index, key: r.key, value: r.value });
        if (r.value === "__resume__") needsResume = true;
      }
    }
    return { values, resume: needsResume ? await resumeFile(ctx.key) : null };
  },

  async offerSave({ url, username, password }, sender) {
    const local = await loadLocal();
    const host = safeHost(url);
    if (!local || !password || !host || local.settings.neverSave.includes(host)) return { prompt: false };
    const ctx = await unlocked().catch(() => null);
    if (ctx) {
      const same = liveItems(ctx.vault).find((i) => matchesSite(i, url) && i.username === username);
      if (same && same.password === password) return { prompt: false };
    }
    const pending = await getPending();
    pending[sender.tab.id] = { url, username, password, at: Date.now(),
      update: !!ctx && liveItems(ctx.vault).some((i) => matchesSite(i, url) && i.username === username) };
    await setPending(pending);
    return { prompt: true };
  },

  async pendingSave(_msg, sender) {
    const pending = await getPending();
    const p = pending[sender.tab.id];
    if (!p || Date.now() - p.at > 5 * 60_000) return null;
    return { host: safeHost(p.url), username: p.username, update: p.update, locked: !(await getSession()) };
  },

  async answerSave({ answer }, sender) {
    const pending = await getPending();
    const p = pending[sender.tab.id];
    delete pending[sender.tab.id];
    await setPending(pending);
    if (!p) return { ok: false };
    if (answer === "never") {
      const local = await loadLocal();
      local.settings.neverSave = [...new Set([...local.settings.neverSave, safeHost(p.url)])];
      await saveLocal(local);
      return { ok: true };
    }
    if (answer !== "save") return { ok: true };
    const ctx = await unlocked();
    const existing = liveItems(ctx.vault).find((i) => matchesSite(i, p.url) && i.username === p.username);
    const { vault } = upsertItem(ctx.vault, { ...(existing || {}), id: existing?.id, type: "login",
      name: existing?.name || safeHost(p.url), url: existing?.url || p.url, username: p.username, password: p.password });
    await persist(ctx, vault);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  let handler;
  if (fromExtensionPage) handler = handlers[msg?.type];
  else if (sender.tab && typeof msg?.type === "string" && msg.type.startsWith("cs:")) {
    handler = contentHandlers[msg.type.slice(3)];
  }
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;   // async response
});

chrome.tabs.onRemoved?.addListener(async (tabId) => {
  const pending = await getPending();
  if (pending[tabId]) {
    delete pending[tabId];
    await setPending(pending);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autolock") lock();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "fill-application") {
    handlers.fillApplication().catch(() => {});
    return;
  }
  if (command !== "fill-login") return;
  try {
    const { vault } = await unlocked();
    const tab = await activeTab();
    const match = liveItems(vault).find((i) => matchesSite(i, tab?.url));
    if (match) await inject(tab, fillLoginInPage, [match.username, match.password]);
  } catch {
    // Locked or no match: the shortcut does nothing rather than surfacing anything to the page.
  }
});
