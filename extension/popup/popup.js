// Lockbox popup. All vault operations go through the service worker; the DOM is built with
// createElement/textContent only (never innerHTML with vault data), so a malicious saved site
// name can't inject script into the popup.

import { passwordStrength } from "../src/crypto.js";
import { DEFAULT_API } from "../src/sync.js";
import { PROFILE_FIELDS } from "../src/vault.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const ui = { tab: "login", query: "", state: null, items: [], matches: [] };

const PROFILE_LABELS = {
  givenName: "First name", familyName: "Last name", email: "Email", phone: "Phone",
  organization: "Company", address1: "Address line 1", address2: "Address line 2", city: "City",
  state: "State / province", postalCode: "Postal code", country: "Country",
};

// ---------------------------------------------------------------- helpers

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw new Error("Lockbox didn't respond");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

let toastTimer;
function toast(msg, error = false) {
  toastEl.textContent = msg;
  toastEl.className = `toast${error ? " error" : ""}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
}

async function copy(text, what) {
  await navigator.clipboard.writeText(text);
  toast(`${what} copied`);
}

function field(label, input) {
  return h("label", { class: "field" }, h("span", {}, label), input);
}

function passwordInput(props = {}) {
  const input = h("input", { type: "password", autocomplete: "off", spellcheck: false, ...props });
  const reveal = h("button", { class: "btn sm reveal", type: "button", onclick: () => {
    input.type = input.type === "password" ? "text" : "password";
    reveal.textContent = input.type === "password" ? "Show" : "Hide";
  } }, "Show");
  return { wrap: h("div", { class: "pw-wrap" }, input, reveal), input };
}

function busy(button, fn) {
  return async (e) => {
    e?.preventDefault?.();
    button.disabled = true;
    try {
      await fn();
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "";
  }
}

// ---------------------------------------------------------------- views

function viewSetup() {
  const pw = passwordInput({ placeholder: "Master password", autofocus: true });
  const confirm = passwordInput({ placeholder: "Repeat it" });
  const meter = h("i");
  const strengthText = h("p", { class: "hint" }, " ");
  const err = h("div", { class: "err" });
  pw.input.addEventListener("input", () => {
    const s = passwordStrength(pw.input.value);
    meter.style.width = `${Math.min(100, s.bits)}%`;
    meter.style.background = s.bits >= 80 ? "var(--ok)" : s.bits >= 50 ? "var(--warn)" : "var(--danger)";
    strengthText.textContent = pw.input.value ? `Strength: ${s.label} (~${s.bits} bits)` : " ";
  });
  const create = h("button", { class: "btn primary block", type: "submit" }, "Create vault");
  const form = h("form", {},
    h("h1", {}, "Create your vault"),
    h("p", { class: "sub" }, "Everything is encrypted on this device with your master password before it's stored or synced."),
    h("div", { class: "warn-box" }, "There is no password reset. If you forget your master password, the vault cannot be recovered by anyone."),
    field("Master password", pw.wrap), h("div", { class: "strength" }, meter), strengthText,
    field("Confirm master password", confirm.wrap), err, create,
    h("h2", {}, "Already use Lockbox on another computer?"),
    h("button", { class: "btn block", type: "button", onclick: () => render(viewConnect) }, "Connect to my synced vault"));
  form.addEventListener("submit", busy(create, async () => {
    err.textContent = "";
    if (pw.input.value !== confirm.input.value) { err.textContent = "Passwords don't match"; return; }
    if (passwordStrength(pw.input.value).bits < 50) { err.textContent = "Use a longer master password (a few random words works well)"; return; }
    create.textContent = "Deriving keys…";
    await send("create", { password: pw.input.value });
    await boot();
  }));
  return form;
}

function viewConnect() {
  const api = h("input", { type: "url", value: DEFAULT_API });
  const pw = passwordInput({ placeholder: "Master password" });
  const go = h("button", { class: "btn primary block", type: "submit" }, "Connect");
  const form = h("form", {},
    h("button", { class: "back", type: "button", onclick: () => render(viewSetup) }, "← Back"),
    h("h1", {}, "Connect to synced vault"),
    h("p", { class: "sub" }, "Downloads your encrypted vault and unlocks it here with your master password."),
    field("Sync server", api), field("Master password", pw.wrap), go);
  form.addEventListener("submit", busy(go, async () => {
    go.textContent = "Connecting…";
    await send("connect", { apiBase: api.value.trim(), password: pw.input.value });
    await boot();
  }));
  return form;
}

function viewLocked() {
  const pw = passwordInput({ placeholder: "Master password", autofocus: true });
  const go = h("button", { class: "btn primary block", type: "submit" }, "Unlock");
  const form = h("form", {},
    h("h1", {}, "Vault locked"),
    h("p", { class: "sub" }, ui.state.tab?.host ? `On ${ui.state.tab.host}` : "Enter your master password."),
    field("Master password", pw.wrap), go);
  form.addEventListener("submit", busy(go, async () => {
    go.textContent = "Unlocking…";
    try {
      await send("unlock", { password: pw.input.value });
    } finally {
      go.textContent = "Unlock";
    }
    await boot();
  }));
  setTimeout(() => pw.input.focus(), 0);
  return form;
}

function itemRow(item) {
  const sub = item.type === "login" ? (item.username || hostOf(item.url))
    : item.type === "note" ? (item.text || "").slice(0, 60) : [item.fields.givenName, item.fields.familyName].join(" ");
  const acts = h("div", { class: "acts" });
  if (item.type === "login") {
    if (ui.matches.includes(item.id)) {
      const fill = h("button", { class: "btn sm primary", title: "Fill on this page" }, "Fill");
      fill.addEventListener("click", busy(fill, async () => { await send("fill", { id: item.id }); window.close(); }));
      acts.append(fill);
    }
    acts.append(h("button", { class: "btn sm", title: "Copy password", onclick: (e) => { e.stopPropagation(); copy(item.password, "Password"); } }, "⧉"));
  } else if (item.type === "profile") {
    const fill = h("button", { class: "btn sm", title: "Fill this form" }, "Fill form");
    fill.addEventListener("click", busy(fill, async () => {
      const r = await send("fillProfile", { id: item.id });
      toast(`Filled ${r.filled} field${r.filled === 1 ? "" : "s"}`);
    }));
    acts.append(fill);
  }
  for (const b of acts.querySelectorAll("button")) b.addEventListener("click", (e) => e.stopPropagation());
  return h("div", { class: "item", onclick: () => render(() => viewEdit(item)) },
    h("div", { class: "avatar" }, (item.name || "?")[0]),
    h("div", { class: "meta" }, h("b", {}, item.name), h("small", {}, sub || " ")), acts);
}

function viewMain() {
  const host = ui.state.tab?.host;
  const matching = ui.items.filter((i) => ui.matches.includes(i.id));
  const wrap = h("div");

  if (host) {
    const save = h("button", { class: "btn sm" }, "Save login");
    save.addEventListener("click", busy(save, async () => {
      const found = await send("capture");
      render(() => viewEdit({ type: "login", name: hostOf(found.url), url: found.url,
        username: found.username, password: found.password }));
    }));
    wrap.append(h("div", { class: "site" },
      h("div", {}, h("small", {}, "This site"), h("b", {}, host)),
      matching.length ? h("span", { class: "hint" }, `${matching.length} saved`) : save));
    if (matching.length) wrap.append(h("div", { class: "list" }, matching.map(itemRow)));
  }

  const jobRow = h("div", { class: "row", style: "margin-bottom:10px" });
  if (host) {
    const fillApp = h("button", { class: "btn primary", title: "⌘/Ctrl+Shift+Y" }, "Fill application");
    fillApp.addEventListener("click", busy(fillApp, async () => {
      const r = await send("fillApplication");
      if (r?.error) throw new Error(r.error);
      if (!r) throw new Error("No form found on this page (reload the page if Lockbox was just installed)");
      window.close();
    }));
    jobRow.append(fillApp);
  }
  jobRow.append(h("button", { class: "btn", onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL("profile/profile.html") }) }, "Work profile"));
  wrap.append(jobRow);

  const search = h("input", { type: "text", placeholder: "Search vault", value: ui.query, oninput: (e) => {
    ui.query = e.target.value;
    drawList();
  } });
  const add = h("button", { class: "btn primary", onclick: () => render(() => viewEdit({ type: ui.tab })) }, "+ New");
  const tabs = h("div", { class: "tabs" }, [["login", "Logins"], ["note", "Notes"], ["profile", "Profiles"]].map(([k, label]) =>
    h("button", { class: ui.tab === k ? "on" : "", onclick: () => { ui.tab = k; render(viewMain); } }, label)));
  const list = h("div", { class: "list" });
  function drawList() {
    const q = ui.query.toLowerCase();
    const rows = ui.items.filter((i) => i.type === ui.tab && (!q || [i.name, i.url, i.username, i.text,
      ...Object.values(i.fields || {})].some((v) => String(v || "").toLowerCase().includes(q))));
    list.replaceChildren(...(rows.length ? rows.map(itemRow)
      : [h("div", { class: "empty" }, ui.query ? "No matches." : `No ${ui.tab === "login" ? "logins" : ui.tab + "s"} yet.`)]));
  }
  drawList();
  wrap.append(h("div", { class: "toolbar" }, search, add), tabs, list);
  return wrap;
}

function viewEdit(item) {
  const isNew = !item.id;
  const inputs = {};
  const body = [];
  inputs.name = h("input", { type: "text", value: item.name || "", placeholder: "Name" });
  body.push(field("Name", inputs.name));
  if (item.type === "login") {
    inputs.url = h("input", { type: "url", value: item.url || "", placeholder: "https://example.com" });
    inputs.username = h("input", { type: "text", value: item.username || "", autocomplete: "off" });
    const pw = passwordInput({ value: item.password || "" });
    inputs.password = pw.input;
    inputs.notes = h("textarea", { placeholder: "Notes (optional)" }, item.notes || "");
    body.push(field("Website", inputs.url), field("Username / email", inputs.username), field("Password", pw.wrap),
      h("div", { class: "row" },
        h("button", { class: "btn sm", type: "button", onclick: () => copy(inputs.username.value, "Username") }, "Copy username"),
        h("button", { class: "btn sm", type: "button", onclick: () => copy(inputs.password.value, "Password") }, "Copy password")),
      h("div", { style: "height:10px" }), field("Notes", inputs.notes));
  } else if (item.type === "note") {
    inputs.text = h("textarea", { style: "min-height:180px" }, item.text || "");
    body.push(field("Secure note", inputs.text));
  } else {
    const grid = h("div", { class: "kv" });
    for (const f of PROFILE_FIELDS) {
      inputs[`f_${f}`] = h("input", { type: f === "email" ? "email" : "text", value: item.fields?.[f] || "" });
      grid.append(field(PROFILE_LABELS[f], inputs[`f_${f}`]));
    }
    body.push(grid);
  }

  const save = h("button", { class: "btn primary", type: "submit" }, isNew ? "Save" : "Save changes");
  const del = !isNew && h("button", { class: "btn danger", type: "button" }, "Delete");
  const form = h("form", {},
    h("button", { class: "back", type: "button", onclick: () => boot() }, "← Back"),
    h("h1", {}, isNew ? `New ${item.type}` : item.name), ...body,
    h("div", { class: "foot-actions" }, del, h("span", { class: "spacer" }), save));
  form.addEventListener("submit", busy(save, async () => {
    const next = { id: item.id, type: item.type, name: inputs.name.value };
    if (item.type === "login") Object.assign(next, { url: inputs.url.value, username: inputs.username.value,
      password: inputs.password.value, notes: inputs.notes.value });
    if (item.type === "note") next.text = inputs.text.value;
    if (item.type === "profile") next.fields = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, inputs[`f_${f}`].value]));
    if (item.type === "login" && !next.url) throw new Error("Website is required for a login");
    await send("save", { item: next });
    toast("Saved");
    await boot();
  }));
  if (del) del.addEventListener("click", busy(del, async () => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    await send("remove", { id: item.id });
    toast("Deleted");
    await boot();
  }));
  return form;
}

function viewSettings() {
  const s = ui.state.settings;
  const minutes = h("input", { type: "number", min: 1, max: 240, value: s.autoLockMinutes });
  const saveLock = h("button", { class: "btn sm" }, "Save");
  saveLock.addEventListener("click", busy(saveLock, async () => {
    await send("settings", { patch: { autoLockMinutes: minutes.value } });
    toast("Saved");
  }));

  const syncBox = h("div");
  if (s.sync.enabled) {
    const now = h("button", { class: "btn sm primary" }, "Sync now");
    now.addEventListener("click", busy(now, async () => { await send("syncNow"); toast("Synced"); await boot(viewSettings); }));
    const off = h("button", { class: "btn sm" }, "Turn off");
    off.addEventListener("click", busy(off, async () => { await send("disableSync"); await boot(viewSettings); }));
    syncBox.append(
      h("p", { class: "status-line" }, s.sync.lastError ? `⚠ ${s.sync.lastError}`
        : `Synced with ${hostOf(s.sync.apiBase)}${s.sync.lastSyncAt ? ` · ${new Date(s.sync.lastSyncAt).toLocaleString()}` : ""}`),
      h("div", { class: "row" }, now, off));
  } else {
    const api = h("input", { type: "url", value: s.sync.apiBase || DEFAULT_API });
    const token = h("input", { type: "password", placeholder: "Only needed the first time", autocomplete: "off" });
    const on = h("button", { class: "btn primary block" }, "Turn on sync");
    on.addEventListener("click", busy(on, async () => {
      await send("enableSync", { apiBase: api.value.trim(), enrollToken: token.value.trim() });
      toast("Sync is on");
      await boot(viewSettings);
    }));
    syncBox.append(h("p", { class: "hint" }, "Uploads only the encrypted vault. Your site never sees your passwords or master password."),
      field("Sync server", api), field("Enrollment code", token), on);
  }

  const exp = h("button", { class: "btn sm" }, "Export encrypted backup");
  exp.addEventListener("click", busy(exp, async () => {
    const { filename, data } = await send("exportBackup");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }));
  const wipe = h("button", { class: "btn sm danger" }, "Delete vault from this device");
  wipe.addEventListener("click", busy(wipe, async () => {
    const typed = prompt("This removes the vault from this browser. Type DELETE to confirm.");
    if (typed === null) return;
    await send("wipe", { confirm: typed });
    await boot();
  }));

  const quick = ui.items.filter((i) => i.type === "quick");
  const quickList = h("div", { class: "list" }, quick.map((q) => {
    const del = h("button", { class: "btn sm danger" }, "Remove");
    del.addEventListener("click", busy(del, async () => { await send("remove", { id: q.id }); await boot(viewSettings); }));
    return h("div", { class: "item", style: "cursor:default" }, h("div", { class: "avatar" }, "★"),
      h("div", { class: "meta" }, h("b", {}, q.name), h("small", {}, "••••••••••")), h("div", { class: "acts" }, del));
  }));
  const qName = h("input", { type: "text", placeholder: `Label, e.g. "Usual password ${quick.length + 1}"` });
  const qPw = passwordInput({ placeholder: "The password" });
  const qAdd = h("button", { class: "btn sm primary" }, "Add quick password");
  qAdd.addEventListener("click", busy(qAdd, async () => {
    if (!qPw.input.value) throw new Error("Enter the password");
    await send("save", { item: { type: "quick", name: qName.value || `Usual password ${quick.length + 1}`, password: qPw.input.value } });
    toast("Quick password saved");
    await boot(viewSettings);
  }));

  const inline = h("input", { type: "checkbox", style: "width:auto" });
  inline.checked = s.inlineHelper !== false;
  inline.addEventListener("change", async () => {
    await send("settings", { patch: { inlineHelper: inline.checked } });
    toast(inline.checked ? "In-page helper on" : "In-page helper off");
  });

  const quiet = h("input", { type: "checkbox", style: "width:auto" });
  quiet.checked = s.quietChrome !== false;
  const quietStatus = h("p", { class: "hint" });
  const showQuiet = (status) => {
    quietStatus.textContent = {
      quiet: "Chrome's own prompts are off right now (they come back when Lockbox locks).",
      chrome: "Chrome's own password and address prompts are on.",
      blocked: "Chrome won't let Lockbox change this (set by your organisation or another extension).",
      unsupported: "Not supported in this browser.",
    }[status] || "";
  };
  showQuiet(ui.state.chromePrompts);
  quiet.addEventListener("change", async () => {
    const r = await send("settings", { patch: { quietChrome: quiet.checked } });
    showQuiet(r.chromePrompts);
  });

  return h("div", {},
    h("button", { class: "back", onclick: () => boot() }, "← Back"),
    h("h1", {}, "Settings"),
    h("h2", {}, "Chrome's built-in prompts"),
    h("label", { class: "row", style: "gap:8px;cursor:pointer" }, quiet,
      h("span", {}, "Turn off Chrome's “Save password?” and address autofill while Lockbox is unlocked")),
    quietStatus,
    h("h2", {}, "Quick passwords"),
    h("p", { class: "hint" }, "Passwords you reuse. On a site with no saved login, tap the password field to try them; after you sign in, Lockbox offers to save the login."),
    quickList, field("Label", qName), field("Password", qPw.wrap), qAdd,
    h("h2", {}, "In-page helper"),
    h("label", { class: "row", style: "gap:8px;cursor:pointer" }, inline, h("span", {}, "Show the Lockbox badge and menu when I tap form fields")),
    h("h2", {}, "Auto-lock"), h("div", { class: "row" }, h("span", {}, "Lock after (minutes)"), minutes, saveLock),
    h("h2", {}, "Sync"), syncBox,
    h("h2", {}, "Backup"), h("p", { class: "hint" }, "The backup file is encrypted; you need your master password to use it."),
    h("div", { class: "row" }, exp),
    h("h2", {}, "Danger zone"), h("div", { class: "row" }, wipe));
}

// ---------------------------------------------------------------- shell

function render(view) {
  app.replaceChildren(view());
}

async function boot(view) {
  try {
    ui.state = await send("state");
  } catch (err) {
    app.replaceChildren(h("div", { class: "empty" }, err.message));
    return;
  }
  const unlocked = ui.state.status === "unlocked";
  document.getElementById("bar-actions").hidden = !unlocked;
  const dot = document.getElementById("sync-dot");
  const s = ui.state.settings.sync;
  dot.className = `sync-dot${s.enabled ? (s.lastError ? " err" : " ok") : ""}`;
  dot.title = s.enabled ? (s.lastError ? `Sync error: ${s.lastError}` : "Sync on") : "Sync off";
  if (ui.state.status === "setup") return render(viewSetup);
  if (ui.state.status === "locked") return render(viewLocked);
  try {
    ({ items: ui.items, matches: ui.matches } = await send("list"));
  } catch (err) {
    if (err.message === "locked") return boot();
    throw err;
  }
  render(view || viewMain);
}

document.getElementById("btn-lock").addEventListener("click", async () => { await send("lock"); await boot(); });
document.getElementById("btn-settings").addEventListener("click", () => render(viewSettings));
boot();
