// Lockbox popup. All vault operations go through the service worker; the DOM is built with
// createElement/textContent only (never innerHTML with vault data), so a malicious saved site
// name can't inject script into the popup.

import { passwordStrength } from "../src/crypto.js";
import { DEFAULT_API } from "../src/sync.js";
import { PROFILE_FIELDS } from "../src/vault.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
// popup.html?page&q=example.com opens the same UI in a full tab, pre-searched for a site.
const params = new URLSearchParams(location.search);
const ui = { tab: "login", query: params.get("q") || "", state: null, items: [], matches: [] };
if (params.has("page")) document.body.classList.add("page");

const PROFILE_LABELS = {
  givenName: "First name", familyName: "Last name", email: "Email", phone: "Phone", dateOfBirth: "Date of birth",
  organization: "Company", address1: "Address line 1", address2: "Address line 2", city: "City",
  state: "State / province", postalCode: "Postal code", country: "Country",
};

// ---------------------------------------------------------------- helpers

/** Map a pasted JSON profile (flat Lockbox fields, or nested like basic_information/contact)
 *  onto form-profile fields; everything else becomes readable notes. */
function profileFromJSON(obj) {
  const b = obj.basic_information || obj.contact || obj.personal || obj;
  const pick = (...keys) => keys.map((k) => b[k]).find((v) => typeof v === "string" && v.trim()) || "";
  const full = pick("full_name", "name", "fullName");
  const loc = typeof b.location === "object" && b.location ? b.location : {};
  const addr = typeof b.address === "object" && b.address ? b.address : {};
  const fields = {
    givenName: pick("givenName", "first_name", "firstName") || full.split(/\s+/)[0] || "",
    familyName: pick("familyName", "last_name", "lastName") || (full.includes(" ") ? full.split(/\s+/).slice(-1)[0] : ""),
    email: pick("email"), phone: pick("phone", "mobile"),
    dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(pick("dateOfBirth", "date_of_birth", "dob")) ? pick("dateOfBirth", "date_of_birth", "dob") : "",
    organization: pick("organization", "company"),
    address1: pick("address1") || addr.line1 || addr.street || (typeof b.address === "string" ? b.address : ""),
    address2: pick("address2") || addr.line2 || "",
    city: pick("city") || loc.city || addr.city || "",
    state: pick("state") || loc.state || addr.state || "",
    postalCode: pick("postalCode", "zip", "postal_code") || loc.postal_code || addr.zip || addr.postal_code || "",
    country: pick("country") || loc.country || addr.country || "",
  };
  const label = (k) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const line = (v) => Array.isArray(v) ? v.map(line).join(", ")
    : v && typeof v === "object" ? Object.entries(v).filter(([, x]) => x != null && x !== "").map(([k, x]) => `${label(k)}: ${line(x)}`).join("; ")
    : String(v);
  const sections = Object.entries(obj).filter(([k]) => obj[k] !== b).map(([k, v]) =>
    `${label(k).toUpperCase()}\n${Array.isArray(v) ? v.map((x) => `- ${line(x)}`).join("\n") : line(v)}`);
  return { name: obj.name && typeof obj.name === "string" ? obj.name : "", fields, notes: sections.join("\n\n") };
}

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

  // Self-check: is the page helper running on this tab?
  const helperNote = h("div");
  if (host) send("pageHelper").then((r) => {
    if (r.status !== "missing") return;
    const refresh = h("button", { class: "btn sm primary" }, "Refresh page");
    refresh.addEventListener("click", busy(refresh, async () => { await send("refreshTab"); window.close(); }));
    helperNote.replaceChildren(h("div", { class: "warn-box" },
      h("b", {}, "Lockbox isn't active on this page yet. "),
      "Refresh it (needed after installing or reloading Lockbox). If it still doesn't appear: chrome://extensions → Lockbox → Details → Site access → “On all sites”.",
      h("div", { style: "margin-top:8px" }, refresh)));
  }).catch(() => {});
  wrap.append(helperNote);

  // One-tap switches on the front page.
  const st = ui.state.settings;
  const hasKey = ui.items.some((i) => i.type === "secret" && i.name === "openrouter");
  const toggle = (label, on, onClick, title) => h("button", { class: `tg${on ? " on" : ""}`, title, onclick: onClick },
    h("span", { class: "sw" }), label);
  const aiBtn = toggle("AI drafting", !!st.ai?.enabled && hasKey, async () => {
    if (!hasKey) { render(viewSettings); toast("Add your OpenRouter key first"); return; }
    await send("settings", { patch: { ai: { enabled: !st.ai?.enabled } } });
    await boot();
  }, hasKey ? "Show “Draft with AI” on written-answer fields" : "Add your OpenRouter key in Settings");
  const chromeBtn = toggle("Quiet Chrome", st.quietChrome !== false, async () => {
    const r = await send("settings", { patch: { quietChrome: st.quietChrome === false } });
    if (r.chromePrompts === "blocked") toast("Chrome won't let Lockbox change this setting", true);
    await boot();
  }, "Turn off Chrome's own “Save password?” and address autofill while Lockbox is unlocked");
  const helperBtn = toggle("Badge", st.inlineHelper !== false, async () => {
    await send("settings", { patch: { inlineHelper: st.inlineHelper === false } });
    toast(st.inlineHelper === false ? "Badge on: refresh open pages" : "Badge off");
    await boot();
  }, "Show the Lockbox badge and menu when you tap form fields");
  wrap.append(h("div", { class: "toggles" }, helperBtn, aiBtn, chromeBtn));

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
      const type = f === "email" ? "email" : f === "dateOfBirth" ? "date" : "text";
      inputs[`f_${f}`] = h("input", { type, value: item.fields?.[f] || "" });
      grid.append(field(PROFILE_LABELS[f], inputs[`f_${f}`]));
    }
    inputs.notes = h("textarea", { style: "min-height:120px", placeholder: "Anything else: education, documents, family…" }, item.notes || "");
    // Paste a JSON file (e.g. a detailed personal profile) to fill the boxes above in one go.
    const paste = h("textarea", { placeholder: "Paste JSON here", style: "min-height:70px" });
    const apply = h("button", { class: "btn sm", type: "button" }, "Fill from JSON");
    apply.addEventListener("click", () => {
      let parsed;
      try { parsed = JSON.parse(paste.value); } catch { return toast("That isn't valid JSON", true); }
      const { name, fields, notes } = profileFromJSON(parsed);
      for (const [f, v] of Object.entries(fields)) if (v) inputs[`f_${f}`].value = v;
      if (notes) inputs.notes.value = notes;
      if (!inputs.name.value) inputs.name.value = name || "Personal";
      paste.value = "";
      toast("Filled from JSON. Check it, then Save");
    });
    body.push(grid, field("Notes", inputs.notes),
      h("details", { class: "import" }, h("summary", {}, "Import from JSON"), paste, apply));
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
    if (item.type === "profile") {
      next.fields = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, inputs[`f_${f}`].value]));
      next.notes = inputs.notes.value;
    }
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
  const minutes = h("select", { style: "width:auto" },
    [[0, "When I quit Chrome"], [15, "After 15 min idle"], [30, "After 30 min idle"], [60, "After 1 hour idle"], [240, "After 4 hours idle"]]
      .map(([v, label]) => h("option", { value: String(v) }, label)));
  minutes.value = String(s.autoLockMinutes ?? 0);
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
  // Sites where you chose "Never here" on the save prompt; remove one to be asked again.
  const never = s.neverSave || [];
  const neverList = h("div", { class: "list" }, ...(never.length ? never.map((site) => {
    const rm = h("button", { class: "btn sm", title: `Ask to save on ${site} again` }, "Remove");
    rm.addEventListener("click", busy(rm, async () => {
      await send("settings", { patch: { neverSave: never.filter((x) => x !== site) } });
      await boot(viewSettings);
    }));
    return h("div", { class: "item", style: "cursor:default" }, h("div", { class: "avatar" }, site[0]),
      h("div", { class: "meta" }, h("b", {}, site)), h("div", { class: "acts" }, rm));
  }) : [h("p", { class: "hint" }, "None. Sites where you choose “Never here” on the save prompt appear here.")]));

  const csvIn = h("input", { type: "file", accept: ".csv,text/csv", hidden: true });
  const imp = h("button", { class: "btn sm" }, "Import passwords (CSV)");
  imp.addEventListener("click", () => csvIn.click());
  csvIn.addEventListener("change", busy(imp, async () => {
    const file = csvIn.files[0];
    csvIn.value = "";
    if (!file) return;
    const r = await send("importCsv", { text: await file.text() });
    toast(`Imported ${r.added} of ${r.total}${r.same ? `, ${r.same} already saved` : ""}${r.kept ? `, ${r.kept} kept Lockbox's version` : ""}. Now delete the CSV file.`);
    await boot(viewSettings);
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

  // ---- AI drafting (OpenRouter)
  const ai = s.ai || { enabled: false, model: "openrouter/auto" };
  const keyItem = ui.items.find((i) => i.type === "secret" && i.name === "openrouter");
  const aiOn = h("input", { type: "checkbox", style: "width:auto" });
  aiOn.checked = !!ai.enabled;
  aiOn.addEventListener("change", async () => {
    if (aiOn.checked && !keyItem) { aiOn.checked = false; toast("Save your OpenRouter key first", true); return; }
    await send("settings", { patch: { ai: { enabled: aiOn.checked } } });
    toast(aiOn.checked ? "AI drafting on" : "AI drafting off");
  });
  const keyIn = passwordInput({ placeholder: keyItem ? "Saved · paste a new key to replace" : "sk-or-…" });
  const model = h("input", { type: "text", value: ai.model || "openrouter/auto", list: "or-models", spellcheck: false });
  const models = h("datalist", { id: "or-models" });
  fetch("https://openrouter.ai/api/v1/models").then((r) => r.json()).then((d) => {
    const ids = (d.data || []).map((m) => m.id).sort();
    models.replaceChildren(...["openrouter/auto", ...ids].map((id) => h("option", { value: id })));
  }).catch(() => {});
  const aiSave = h("button", { class: "btn sm primary" }, "Save AI settings");
  aiSave.addEventListener("click", busy(aiSave, async () => {
    const key = keyIn.input.value.trim();
    if (key) {
      if (!/^sk-or-/.test(key)) throw new Error("That doesn't look like an OpenRouter key (sk-or-…)");
      await send("save", { item: { id: keyItem?.id, type: "secret", name: "openrouter", password: key } });
    }
    await send("settings", { patch: { ai: { model: model.value.trim() || "openrouter/auto", ...(key ? { enabled: true } : {}) } } });
    toast(key ? "Key saved · AI drafting on" : "Saved");
    await boot(viewSettings);
  }));

  return h("div", {},
    h("button", { class: "back", onclick: () => boot() }, "← Back"),
    h("h1", {}, "Settings"),
    h("h2", {}, "AI drafting (OpenRouter)"),
    h("label", { class: "row", style: "gap:8px;cursor:pointer" }, aiOn, h("span", {}, "Show “Draft with AI” on written-answer fields")),
    h("p", { class: "hint" }, "When you click it, your work profile, the question and the job page text go to the model below via OpenRouter. Tip: make a separate OpenRouter key for Lockbox with a credit limit."),
    field(keyItem ? "OpenRouter API key (saved, encrypted)" : "OpenRouter API key", keyIn.wrap),
    field("Model (e.g. openrouter/auto, or pick from the list)", model), models, aiSave,
    h("h2", {}, "Chrome's built-in prompts"),
    h("label", { class: "row", style: "gap:8px;cursor:pointer" }, quiet,
      h("span", {}, "Turn off Chrome's “Save password?” and address autofill while Lockbox is unlocked")),
    quietStatus,
    h("h2", {}, "Quick passwords"),
    h("p", { class: "hint" }, "Passwords you reuse. On a site with no saved login, tap the password field to try them; after you sign in, Lockbox offers to save the login."),
    quickList, field("Label", qName), field("Password", qPw.wrap), qAdd,
    h("h2", {}, "In-page helper"),
    h("label", { class: "row", style: "gap:8px;cursor:pointer" }, inline, h("span", {}, "Show the Lockbox badge and menu when I tap form fields")),
    h("h2", {}, "Lock"), h("div", { class: "row" }, h("span", {}, "Ask for master password"), minutes, saveLock),
    h("h2", {}, "Sync"), syncBox,
    h("h2", {}, "Never save on"), neverList,
    h("h2", {}, "Import passwords"),
    h("p", { class: "hint" }, "Chrome: open chrome://password-manager/settings → Export passwords. Apple Passwords app: File → Export All Passwords. Then choose the CSV here. The CSV is not encrypted: delete it (and empty the Bin) once imported."),
    h("div", { class: "row" }, imp, csvIn),
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
document.getElementById("btn-full").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html?page") });
  window.close();
});
document.getElementById("btn-full").hidden = params.has("page");
boot();
