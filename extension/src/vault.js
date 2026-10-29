import { normalizeProfile } from "./jobfields.js";

// Vault data model: plain objects, so they can be encrypted, merged and synced as one blob.
//
// item = { id, type: "login" | "note" | "profile" | "job" | "quick", name, updatedAt, deleted?,
//          login:   url, username, password, notes
//          note:    text
//          profile: fields { givenName, familyName, email, phone, dateOfBirth (YYYY-MM-DD), address1,
//                            address2, city, state, postalCode, country, organization }, notes
//          job:     profile (work profile, Nightshift profile.yaml schema; see jobfields.js)
//          quick:   password (a password you reuse, offered on password fields of new sites)
//          secret:  password (an API key Lockbox uses for you, e.g. name "openrouter") }
// Deletes are tombstones so a delete on one device survives syncing with another.

export const PROFILE_FIELDS = [
  "givenName", "familyName", "email", "phone", "dateOfBirth", "organization",
  "address1", "address2", "city", "state", "postalCode", "country",
];

export function emptyVault() {
  return { schema: 1, items: [], updatedAt: Date.now() };
}

function newId() {
  return crypto.randomUUID();
}

export function liveItems(vault) {
  return vault.items.filter((i) => !i.deleted);
}

export function upsertItem(vault, item, now = Date.now()) {
  const clean = sanitize(item);
  const id = clean.id || newId();
  const next = { ...clean, id, updatedAt: now };
  const items = vault.items.some((i) => i.id === id)
    ? vault.items.map((i) => (i.id === id ? next : i))
    : [...vault.items, next];
  return { vault: { ...vault, items, updatedAt: now }, item: next };
}

export function deleteItem(vault, id, now = Date.now()) {
  const items = vault.items.map((i) => (i.id === id ? { id, type: i.type, deleted: true, updatedAt: now } : i));
  return { ...vault, items, updatedAt: now };
}

/** Item-level last-writer-wins merge of two copies of the same vault. Pure and symmetric. */
export function mergeVaults(a, b) {
  const byId = new Map();
  for (const item of [...a.items, ...b.items]) {
    const prev = byId.get(item.id);
    if (!prev || item.updatedAt > prev.updatedAt
        || (item.updatedAt === prev.updatedAt && JSON.stringify(item) > JSON.stringify(prev))) {
      byId.set(item.id, item);
    }
  }
  const items = [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
  return { schema: 1, items, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0) };
}

function sanitize(item) {
  const type = item.type;
  if (!["login", "note", "profile", "job", "quick", "secret"].includes(type)) throw new Error(`Unknown item type: ${type}`);
  const base = { id: item.id, type, name: String(item.name || "").trim().slice(0, 200) };
  if (type === "login") {
    const url = normalizeUrl(item.url);
    return { ...base, name: base.name || (url ? new URL(url).hostname : "Login"), url,
      username: String(item.username || ""), password: String(item.password || ""),
      notes: String(item.notes || "") };
  }
  if (type === "note") return { ...base, name: base.name || "Note", text: String(item.text || "") };
  if (type === "job") return { ...base, name: base.name || "Work profile", profile: normalizeProfile(item.profile) };
  if (type === "secret") {
    // API keys Lockbox uses on your behalf (e.g. OpenRouter for AI drafting).
    return { ...base, name: base.name || "secret", password: String(item.password || "").trim() };
  }
  if (type === "quick") {
    if (!item.password) throw new Error("Quick password can't be empty");
    return { ...base, name: base.name || "Quick password", password: String(item.password) };
  }
  const fields = {};
  for (const f of PROFILE_FIELDS) fields[f] = String(item.fields?.[f] || "").trim();
  return { ...base, name: base.name || "Profile", fields, notes: String(item.notes || "") };
}

// ---------------------------------------------------------------- site matching

export function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function siteKey(url) {
  const u = new URL(url);
  return { protocol: u.protocol, host: u.hostname.toLowerCase().replace(/^www\./, ""), port: u.port };
}

function isLocalhost(host) {
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

/**
 * Should this login be offered for autofill on this page?
 * Exact host match (www. ignored), same port, and never fill a saved https login into an http
 * page: that blocks look-alike phishing domains and protocol-downgrade tricks. Subdomains do NOT
 * match (accounts.example.com's password is not offered on evil.example.com).
 */
export function matchesSite(item, pageUrl) {
  if (item.type !== "login" || item.deleted || !item.url || !pageUrl) return false;
  let page, saved;
  try {
    page = siteKey(pageUrl);
    saved = siteKey(item.url);
  } catch {
    return false;
  }
  if (!["https:", "http:"].includes(page.protocol)) return false;
  if (page.protocol === "http:" && !isLocalhost(page.host)) return false;
  if (saved.protocol === "https:" && page.protocol !== "https:" && !isLocalhost(page.host)) return false;
  return page.host === saved.host && page.port === saved.port;
}

export function searchItems(vault, query) {
  const q = String(query || "").trim().toLowerCase();
  const items = liveItems(vault);
  if (!q) return items;
  return items.filter((i) => [i.name, i.url, i.username, i.text, ...Object.values(i.fields || {})]
    .some((v) => String(v || "").toLowerCase().includes(q)));
}

// ---------------------------------------------------------------- password CSV import

/** RFC 4180-ish CSV: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const src = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Chrome (name,url,username,password,note), Apple Passwords/Safari (Title,URL,Username,Password,
 *  Notes,OTPAuth) and Firefox (url,username,password,...) exports -> login items. */
export function parsePasswordCsv(text) {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const col = (...names) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const c = { name: col("name", "title"), url: col("url", "website", "login_uri"), user: col("username", "login", "login_username"),
    pw: col("password", "login_password"), note: col("note", "notes") };
  if (c.url < 0 || c.pw < 0) return [];
  return body.map((r) => ({
    name: (c.name >= 0 && r[c.name]) || safeHostOf(r[c.url]), url: r[c.url] || "",
    username: c.user >= 0 ? r[c.user] || "" : "", password: r[c.pw] || "", notes: c.note >= 0 ? r[c.note] || "" : "",
  })).filter((x) => x.password && /^https?:\/\//i.test(x.url));   // skips android:// app entries
}

function safeHostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return String(url || "Login"); }
}
