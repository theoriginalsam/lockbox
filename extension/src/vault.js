// Vault data model: plain objects, so they can be encrypted, merged and synced as one blob.
//
// item = { id, type: "login" | "note" | "profile", name, updatedAt, deleted?,
//          login:   url, username, password, notes
//          note:    text
//          profile: fields { givenName, familyName, email, phone, address1, address2, city,
//                            state, postalCode, country, organization } }
// Deletes are tombstones so a delete on one device survives syncing with another.

export const PROFILE_FIELDS = [
  "givenName", "familyName", "email", "phone", "organization",
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
  if (!["login", "note", "profile"].includes(type)) throw new Error(`Unknown item type: ${type}`);
  const base = { id: item.id, type, name: String(item.name || "").trim().slice(0, 200) };
  if (type === "login") {
    const url = normalizeUrl(item.url);
    return { ...base, name: base.name || (url ? new URL(url).hostname : "Login"), url,
      username: String(item.username || ""), password: String(item.password || ""),
      notes: String(item.notes || "") };
  }
  if (type === "note") return { ...base, name: base.name || "Note", text: String(item.text || "") };
  const fields = {};
  for (const f of PROFILE_FIELDS) fields[f] = String(item.fields?.[f] || "").trim();
  return { ...base, name: base.name || "Profile", fields };
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
