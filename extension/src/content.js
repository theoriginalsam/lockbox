// Lockbox in-page helper (content script, runs on every page and frame).
//
//  • Tap a field  → a small Lockbox badge appears; tap it (or the menu opens itself on job
//    applications) to pick a value: saved logins for this site, your quick passwords, or
//    anything from your work profile.
//  • Fill everything → fills every field it recognises, outlines what it filled, lists the rest.
//    Never submits.
//  • After you sign in somewhere new, offers to save the login.
//
// Privacy: all UI lives in a *closed* shadow root created from this isolated world, so the page's
// own scripts cannot read suggestions. Values are inserted only on a real (isTrusted) user click.
(() => {
  if (window.__lockboxContent) return;
  window.__lockboxContent = true;

  const ATS_HOSTS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|jobvite\.com|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com|breezy\.hr|taleo\.net|successfactors|rippling\.com|dover\.com|wellfound\.com/i;
  const TEXTISH = new Set(["text", "email", "tel", "url", "number", "search", "password", ""]);

  let status = null;
  let host, root, badge, menu, toast;
  let activeField = null;

  // ---------------------------------------------------------------- messaging

  async function ask(type, payload = {}) {
    try {
      const res = await chrome.runtime.sendMessage({ type: `cs:${type}`, ...payload });
      if (!res) return null;
      if (!res.ok) throw new Error(res.error);
      return res.data;
    } catch (err) {
      if (/context invalidated|Receiving end/i.test(String(err))) teardown();
      throw err;
    }
  }

  async function refreshStatus() {
    status = await ask("status").catch(() => null);
    return status;
  }

  // ---------------------------------------------------------------- field description

  function visible(el) {
    if (!el.isConnected) return false;
    const s = getComputedStyle(el);
    return el.getClientRects().length > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function labelFor(el) {
    const parts = [];
    const ids = el.getAttribute("aria-labelledby");
    if (ids) parts.push(ids.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(" "));
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(textOf(l));
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(textOf(wrap).replace(el.value || "", ""));
    if (!parts.join("").trim()) {
      // Nearest preceding label-like text: Lever/Ashby/Workday put the question in a sibling div.
      let node = el;
      for (let depth = 0; depth < 4 && node && !parts.length; depth++) {
        let sib = node.previousElementSibling;
        while (sib && !parts.length) {
          const t = textOf(sib);
          if (t && t.length < 250 && !sib.querySelector("input,select,textarea")) parts.push(t);
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
        const legend = node?.querySelector?.(":scope > legend");
        if (legend && !parts.length) parts.push(textOf(legend));
      }
    }
    return parts.join(" ").replace(/\s*[*✱]\s*$/, "").slice(0, 300);
  }

  function describe(el) {
    const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text").toLowerCase();
    return {
      label: labelFor(el), name: el.name || "", id: el.id || "", placeholder: el.placeholder || "",
      ariaLabel: el.getAttribute("aria-label") || "", autocomplete: el.getAttribute("autocomplete") || "",
      type, required: el.required || el.getAttribute("aria-required") === "true",
      options: type === "select" ? [...el.options].map((o) => o.text.trim()) : [],
    };
  }

  function isFillable(el) {
    if (!(el instanceof HTMLElement) || el.disabled || el.readOnly || !visible(el)) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    return el.tagName === "INPUT" && (TEXTISH.has(el.type) || ["date", "month"].includes(el.type));
  }

  function looksLikeApplication() {
    if (ATS_HOSTS.test(location.hostname)) return true;
    const file = [...document.querySelectorAll('input[type="file"]')].some((f) => /resume|cv/i.test(labelFor(f) + f.name + f.id));
    return file || /apply|application|career|job/i.test(location.pathname) && document.querySelectorAll("input,select,textarea").length >= 6;
  }

  // ---------------------------------------------------------------- setting values (framework-safe)

  function setValue(el, value) {
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => o.text.trim() === value || o.value === value)
        || [...el.options].find((o) => o.text.trim().toLowerCase() === String(value).toLowerCase());
      if (!opt) return false;
      el.value = opt.value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      el.focus({ preventScroll: true });
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);   // React/Vue controlled inputs
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: value }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function setFile(input, file) {
    const bytes = Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.type || "application/pdf" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ---------------------------------------------------------------- UI shell (closed shadow root)

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .badge { position: fixed; width: 22px; height: 22px; display: grid; place-items: center; padding: 0; cursor: pointer;
      border-radius: 6px; border: 1px solid rgba(15,20,30,.14); background: #fff; color: #2f6fed;
      box-shadow: 0 1px 2px rgba(15,20,30,.08); transition: background .12s, border-color .12s; z-index: 2147483647; }
    .badge:hover, .badge:focus-visible { background: #eef3ff; border-color: #2f6fed; outline: none; }
    .badge svg { width: 13px; height: 13px; display: block; }
    .menu { position: fixed; width: 340px; max-height: 360px; display: flex; flex-direction: column; background: #fff; color: #111418;
      border: 1px solid #dfe3ea; border-radius: 12px; box-shadow: 0 12px 32px rgba(15,20,30,.22); z-index: 2147483647; overflow: hidden; font-size: 13px; }
    .head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #eef0f4; font-weight: 700; }
    .head small { font-weight: 500; color: #6b7280; margin-left: auto; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 16px; height: 16px; display: grid; place-items: center; color: #2f6fed; flex: none; }
    .dot svg { width: 14px; height: 14px; display: block; }
    input.search { margin: 8px 10px 4px; padding: 7px 9px; border: 1px solid #dfe3ea; border-radius: 8px; font-size: 13px; outline: none; }
    input.search:focus { border-color: #2f6fed; }
    .list { overflow: auto; padding: 4px; }
    .opt { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 7px 9px; border-radius: 8px; cursor: pointer; color: inherit; }
    .opt:hover, .opt.sel { background: #eef3ff; }
    .opt b { display: block; font-size: 11.5px; color: #4b5563; font-weight: 600; margin-bottom: 1px; }
    .opt span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .opt.best b { color: #2f6fed; }
    .opt.best b::before { content: "★ "; }
    .sec { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #8a909b; font-weight: 700; padding: 8px 9px 3px; }
    .note { padding: 12px; color: #4b5563; line-height: 1.45; }
    .ai { display: block; width: calc(100% - 8px); margin: 4px; text-align: left; border: 1px dashed #b9c8f5; background: #f5f8ff;
      color: #2f6fed; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; }
    .ai:hover { background: #eaf0ff; }
    .draft { margin: 8px 10px; padding: 10px; border: 1px solid #dfe3ea; border-radius: 8px; max-height: 190px; overflow: auto;
      white-space: pre-wrap; line-height: 1.45; font-size: 13px; }
    .meta { padding: 0 12px 4px; font-size: 11px; color: #8a909b; }
    .warn { font-size: 11.5px; color: #8a5a00; background: #fff6df; padding: 6px 9px; margin: 4px; border-radius: 6px; }
    .foot { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #eef0f4; }
    .btn { flex: 1; height: 30px; border-radius: 8px; border: 1px solid #dfe3ea; background: #f5f6f8; cursor: pointer; font-weight: 600; font-size: 12.5px; color: #111418; }
    .btn.primary { background: #2f6fed; color: #fff; border-color: #2f6fed; }
    .toast { position: fixed; right: 18px; bottom: 18px; width: 320px; background: #111418; color: #fff; border-radius: 12px; padding: 12px 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,.3); z-index: 2147483647; font-size: 13px; line-height: 1.45; }
    .toast .row { display: flex; gap: 6px; margin-top: 10px; }
    .toast .btn { background: #2a2f39; border-color: #3a404c; color: #fff; }
    .toast .btn.primary { background: #5b8cff; border-color: #5b8cff; color: #0b0d12; }
    .toast ul { margin: 6px 0 0; padding-left: 18px; max-height: 120px; overflow: auto; color: #c9ced7; }
    .toast li { cursor: pointer; } .toast li:hover { text-decoration: underline; }
    .fab { position: fixed; right: 18px; bottom: 18px; height: 40px; padding: 0 16px 0 12px; border-radius: 999px; border: 0; cursor: pointer;
      background: #2f6fed; color: #fff; font-weight: 700; font-size: 13px; box-shadow: 0 8px 24px rgba(47,111,237,.45); z-index: 2147483646;
      display: flex; align-items: center; gap: 8px; }
    .fab .dot { color: #fff; }
    :host([data-theme="dark"]) .badge { background: #1d2027; border-color: #3a404c; color: #8fb0ff; }
    :host([data-theme="dark"]) .badge:hover, :host([data-theme="dark"]) .badge:focus-visible { background: #262f45; border-color: #8fb0ff; }
    :host([data-theme="dark"]) .dot { color: #8fb0ff; }
    :host([data-theme="dark"]) .ai { background: #1f2a44; border-color: #3a4f86; color: #9bb8ff; }
    :host([data-theme="dark"]) .draft { border-color: #2f343e; }
    :host([data-theme="dark"]) .menu { background: #1d2027; color: #eef0f4; border-color: #2f343e; }
    :host([data-theme="dark"]) .head, :host([data-theme="dark"]) .foot { border-color: #2f343e; }
    :host([data-theme="dark"]) .opt b { color: #9aa1ad; }
    :host([data-theme="dark"]) .opt:hover, :host([data-theme="dark"]) .opt.sel { background: #262f45; }
    :host([data-theme="dark"]) input.search { background: #15171c; color: #eef0f4; border-color: #2f343e; }
    :host([data-theme="dark"]) .btn { background: #262a33; color: #eef0f4; border-color: #2f343e; }
    :host([data-theme="dark"]) .note { color: #c3c7cf; }
    }`;

  function ensureShell() {
    if (root) return;
    host = document.createElement("lockbox-helper");
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
    root = host.attachShadow({ mode: "closed" });
    // Dev harness only: test pages load this script in the page world and set the flag. In the
    // real extension this runs in an isolated world, where page-set globals are invisible.
    if (window.__LOCKBOX_TEST__) window.__lockboxShadow = root;
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    root.append(style);
    root.addEventListener("focusout", () => closeIfFocusLeft());
    document.documentElement.append(host);
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : String(c));
    return node;
  }

  /** Line-art padlock (SVG built with DOM APIs, no innerHTML). */
  function lockIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
    const rect = document.createElementNS(NS, "rect");
    for (const [k, v] of Object.entries({ x: "5", y: "11", width: "14", height: "10", rx: "2.5" })) rect.setAttribute(k, v);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11");
    svg.append(rect, path);
    return svg;
  }

  function dot() {
    return el("span", { class: "dot" }, lockIcon());
  }

  function trusted(handler) {
    return (e) => {
      if (!e.isTrusted) return;          // ignore clicks synthesised by the page
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    };
  }

  function teardown() {
    host?.remove();
    host = root = badge = menu = toast = null;
  }

  // ---------------------------------------------------------------- badge + menu

  /** Match the website, not the OS: dark UI only when the field itself sits on a dark background. */
  function themeFor(field) {
    let node = field;
    while (node && node.nodeType === 1) {
      const m = getComputedStyle(node).backgroundColor.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/);
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) {
        const lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
        return lum < 0.45 ? "dark" : "light";
      }
      node = node.parentElement;
    }
    return "light";
  }

  function placeNear(node, field, { below = false } = {}) {
    const r = field.getBoundingClientRect();
    if (below) {
      const height = Math.min(360, node.offsetHeight || 360);
      const top = r.bottom + 4 + height > innerHeight && r.top > height + 8 ? r.top - 4 - height : r.bottom + 4;
      node.style.top = `${Math.max(4, top)}px`;
      node.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 348))}px`;
    } else {
      node.style.top = `${r.top + (r.height - 22) / 2}px`;
      node.style.left = `${r.right - 26}px`;
    }
  }

  function hideBadge() {
    badge?.remove();
    badge = null;
  }

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  function showBadge(field) {
    ensureShell();
    hideBadge();
    host.setAttribute("data-theme", themeFor(field));
    badge = el("button", { class: "badge", title: "Lockbox: fill this field", "aria-label": "Lockbox",
      onmousedown: (e) => e.preventDefault(),        // keep focus in the field
      onclick: trusted(() => (menu ? closeMenu() : openMenu(field))) }, lockIcon());
    root.append(badge);
    placeNear(badge, field);
  }

  async function openMenu(field) {
    ensureShell();
    closeMenu();
    const desc = describe(field);
    menu = el("div", { class: "menu", role: "listbox", onmousedown: (e) => e.preventDefault() },
      el("div", { class: "head" }, dot(), "Lockbox", el("small", {}, location.hostname)),
      el("div", { class: "note" }, "Loading…"));
    root.append(menu);
    placeNear(menu, field, { below: true });

    let data;
    try {
      data = await ask("suggest", { field: desc });
    } catch (err) {
      return renderNote(err.message);
    }
    if (!menu) return;
    if (!data || data.locked) renderNote("🔒 Lockbox is locked. Click the Lockbox icon in your toolbar, unlock with your master password, then tap this field again.");
    else if (data.kind === "login") renderLogin(field, data);
    else if (data.empty) renderNote("Add your work profile in Lockbox (toolbar icon → Work profile) to fill job applications.");
    else renderJob(field, data);
    // Re-place now that the real height is known, so an upward-opening menu never covers the field.
    if (menu) placeNear(menu, field, { below: true });
  }

  function renderNote(text) {
    if (!menu) return;
    menu.lastChild.replaceWith(el("div", { class: "note" }, text));
  }

  function option(label, value, onPick, extraClass = "") {
    return el("button", { class: `opt ${extraClass}`, type: "button", onclick: trusted(onPick) },
      el("b", {}, label), el("span", {}, value));
  }

  function renderLogin(field, data) {
    const list = el("div", { class: "list" });
    if (data.logins.length) {
      list.append(el("div", { class: "sec" }, `Saved for ${data.host}`));
      for (const l of data.logins) {
        list.append(option(l.name, l.username || "(no username)", async () => {
          const cred = await ask("login", { id: l.id });
          fillLoginNear(field, cred.username, cred.password);
          closeMenu();
        }));
      }
    }
    if (field.type === "password" && data.quick.length) {
      list.append(el("div", { class: "sec" }, "Quick passwords"));
      list.append(el("div", { class: "warn" }, `Sends one of your reused passwords to ${data.host}. Only use it on the real site.`));
      for (const q of data.quick) {
        list.append(option(q.name, "••••••••••", async () => {
          const { password } = await ask("quick", { id: q.id });
          for (const target of newPasswordFields(field)) setValue(target, password);
          closeMenu();
        }));
      }
    }
    if (!list.children.length) list.append(el("div", { class: "note" }, "Nothing saved for this site yet. After you sign in, Lockbox will offer to save the login."));
    menu.lastChild.replaceWith(list);
  }

  /**
   * The tapped password field plus, on sign-up forms, its "confirm password" twin. Never a
   * "current password" box (change-password forms), and never a field that already has text.
   */
  function newPasswordFields(field) {
    const scope = field.form || field.closest("form, [role=form], main, section, div") || document;
    const isCurrent = (el) => /current-password/.test(el.autocomplete || "")
      || /current|old|existing/i.test(`${el.name} ${el.id} ${labelFor(el)}`);
    const others = [...scope.querySelectorAll('input[type="password"]')]
      .filter((el) => el !== field && visible(el) && !el.value && !isCurrent(el));
    const signUp = /new-password/.test(field.autocomplete || "") || others.some((el) =>
      /new-password/.test(el.autocomplete || "") || /confirm|repeat|retype|re-enter|again|verify/i.test(`${el.name} ${el.id} ${labelFor(el)}`));
    return isCurrent(field) || !signUp ? [field] : [field, ...others.slice(0, 1)];
  }

  function fillLoginNear(field, username, password) {
    const form = field.form || document;
    const pw = field.type === "password" ? field : [...form.querySelectorAll('input[type="password"]')].find(visible);
    const users = [...form.querySelectorAll("input")].filter((i) => visible(i) && ["text", "email", "tel", ""].includes(i.type));
    let user = users.find((i) => /username|email/.test(i.autocomplete || ""));
    if (!user && pw) for (const i of users) if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) user = i;
    if (field.type !== "password" && !pw) user = field;
    if (user && username) setValue(user, username);
    if (pw && password) setValue(pw, password);
  }

  function renderJob(field, data) {
    const wrap = el("div", { style: "display:flex;flex-direction:column;min-height:0" });
    const search = el("input", { class: "search", placeholder: "Search your profile…", type: "text" });
    const list = el("div", { class: "list" });
    const pick = (value) => () => {
      if (field.tagName === "SELECT") {
        if (!setValue(field, value)) return;
      } else setValue(field, value);
      closeMenu();
      flash(field, "#1f9d55");
    };
    let items = [];
    let selected = 0;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      items = q
        ? data.facts.filter((f) => `${f.label} ${f.value}`.toLowerCase().includes(q)).slice(0, 30)
        : data.suggestions;
      selected = 0;
      list.replaceChildren(...(items.length
        ? items.map((f, i) => option(f.label, f.value, pick(f.value), `${f.best ? "best" : ""}${i === selected && q ? " sel" : ""}`))
        : [el("div", { class: "note" }, "No match in your profile. Save a custom answer in Lockbox → Work profile.")]));
    };
    search.addEventListener("input", draw);
    search.addEventListener("mousedown", (e) => e.stopPropagation());   // let the search box take focus
    const textual = field.tagName === "TEXTAREA" || ["text", ""].includes(field.type);
    if (status?.aiReady && textual) {
      wrap.append(el("button", { class: "ai", type: "button", title: "Sends your work profile, this question and the page text to your OpenRouter model",
        onclick: trusted(() => aiDraftFlow(field, describe(field))) }, "✨ Draft with AI"));
    }
    search.addEventListener("keydown", (e) => {
      if (!e.isTrusted) return;
      const opts = list.querySelectorAll(".opt");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        selected = Math.max(0, Math.min(items.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
        opts.forEach((o, i) => o.classList.toggle("sel", i === selected));
        opts[selected]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && items[selected]) {
        e.preventDefault();
        pick(items[selected].value)();
      } else if (e.key === "Escape") {
        closeMenu();
        activeField?.focus();
      }
      e.stopPropagation();
    });
    draw();
    wrap.append(search, list);
    menu.lastChild.replaceWith(wrap);
  }

  function pageContext(field) {
    const main = document.querySelector("main, [role=main], .job, .posting, #content, article") || document.body;
    return { title: document.title, host: location.hostname, text: textOf(main).slice(0, 6000),
      existing: field.value?.trim() || "" };
  }

  async function aiDraftFlow(field, desc) {
    if (!menu) return;
    const body = menu.lastChild;
    body.replaceWith(el("div", { class: "note" }, "✨ Drafting an answer from your profile…"));
    let result;
    try {
      result = await ask("aiDraft", { field: desc, page: pageContext(field) });
    } catch (err) {
      return renderNote(`AI drafting failed: ${err.message}`);
    }
    if (!menu) return;
    if (result.needsInput) {
      menu.lastChild.replaceWith(el("div", {}, el("div", { class: "note" }, `The AI needs something your profile doesn't have: ${result.needsInput}`),
        el("div", { class: "foot" }, el("button", { class: "btn", type: "button", onclick: trusted(() => closeMenu()) }, "OK"))));
      return;
    }
    menu.lastChild.replaceWith(el("div", {},
      el("div", { class: "draft" }, result.text),
      result.model ? el("div", { class: "meta" }, `Drafted by ${result.model} · review before you submit`) : null,
      el("div", { class: "foot" },
        el("button", { class: "btn primary", type: "button", onclick: trusted(() => { setValue(field, result.text); closeMenu(); flash(field, "#1f9d55"); }) }, "Insert"),
        el("button", { class: "btn", type: "button", onclick: trusted(() => aiDraftFlow(field, desc)) }, "Try again"),
        el("button", { class: "btn", type: "button", onclick: trusted(() => closeMenu()) }, "Cancel"))));
    placeNear(menu, field, { below: true });
  }

  function flash(field, color) {
    field.style.setProperty("outline", `2px solid ${color}`, "important");
    field.style.setProperty("outline-offset", "1px", "important");
  }

  // ---------------------------------------------------------------- fill everything

  function collectFields() {
    const fields = [], nodes = [];
    for (const node of document.querySelectorAll("input, select, textarea")) {
      if (node.type === "radio" || node.type === "checkbox" || node.type === "hidden") continue;
      if (node.type === "file") {
        if (!node.disabled) { nodes.push(node); fields.push({ ...describe(node), index: nodes.length - 1 }); }
        continue;
      }
      if (!isFillable(node) || node.type === "password" || node.type === "search") continue;
      if (node.tagName !== "SELECT" && node.value.trim()) continue;              // don't overwrite what you typed
      if (node.tagName === "SELECT" && node.selectedIndex > 0) continue;
      nodes.push(node);
      fields.push({ ...describe(node), index: nodes.length - 1 });
    }
    // Radio groups become one "radio" field whose options are the radio labels.
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (!r.name || r.disabled) continue;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    }
    for (const radios of groups.values()) {
      if (radios.some((r) => r.checked) || !radios.some(visible)) continue;
      const container = radios[0].closest("fieldset, [role=radiogroup], .field, .question, li, div");
      const question = textOf(container?.querySelector("legend, label:not(:has(input)), .label, .question-label, h3, h4, p")) || labelFor(radios[0]);
      const optionLabels = radios.map((r) => labelFor(r) || r.value);
      nodes.push(radios);
      fields.push({ label: question, name: radios[0].name, id: "", type: "radio", options: optionLabels, index: nodes.length - 1 });
    }
    return { fields, nodes };
  }

  async function fillAll() {
    const { fields, nodes } = collectFields();
    if (!fields.length) return { filled: 0, missing: [] };
    const { values, resume } = await ask("plan", { fields: fields.map(({ index, ...f }) => ({ ...f, index })) });
    const done = new Set();
    for (const { index, value } of values) {
      const target = nodes[index];
      let ok = false;
      if (Array.isArray(target)) {
        const i = fields[index].options.indexOf(value);
        if (i >= 0) { target[i].click(); ok = true; }
      } else if (value === "__resume__") {
        ok = resume ? setFile(target, resume) : false;
      } else ok = setValue(target, value);
      if (ok) {
        done.add(index);
        if (!Array.isArray(target) && target.type !== "file") flash(target, "#1f9d55");
      }
    }
    const missing = fields.filter((f) => !done.has(f.index) && f.required && f.type !== "file" || (f.type === "file" && /resume|cv/i.test(f.label) && !done.has(f.index)))
      .map((f) => ({ label: f.label || f.name || "Untitled field", index: f.index }));
    for (const m of missing) {
      const t = nodes[m.index];
      if (!Array.isArray(t)) flash(t, "#d99a00");
    }
    showFillSummary(done.size, missing, nodes);
    return { filled: done.size, missing: missing.map((m) => m.label) };
  }

  function showToast(content, ms = 0) {
    ensureShell();
    toast?.remove();
    toast = el("div", { class: "toast", role: "status" }, ...content);
    root.append(toast);
    if (ms) setTimeout(() => { toast?.remove(); toast = null; }, ms);
  }

  function showFillSummary(count, missing, nodes) {
    const items = missing.slice(0, 12).map((m) => el("li", { onclick: trusted(() => {
      const t = nodes[m.index];
      (Array.isArray(t) ? t[0] : t).scrollIntoView({ behavior: "smooth", block: "center" });
    }) }, m.label));
    showToast([
      el("b", {}, `Lockbox filled ${count} field${count === 1 ? "" : "s"}.`),
      missing.length ? el("div", {}, `${missing.length} still need you:`) : el("div", {}, "Review everything, then submit yourself."),
      missing.length ? el("ul", {}, items) : null,
      el("div", { class: "row" }, el("button", { class: "btn", onclick: trusted(() => { toast.remove(); toast = null; }) }, "Close")),
    ], missing.length ? 0 : 6000);
  }

  function showFab() {
    if (root?.querySelector(".fab") || innerWidth < 360) return;
    ensureShell();
    const fab = el("button", { class: "fab", title: "Fill this application with your Lockbox work profile",
      onclick: trusted(async () => {
        fab.disabled = true;
        try {
          await fillAll();
        } catch (err) {
          showToast([el("b", {}, "Lockbox"), el("div", {}, err.message)], 5000);
        } finally {
          fab.disabled = false;
        }
      }) }, dot(), "Fill application");
    root.append(fab);
  }

  // ---------------------------------------------------------------- save-login offers

  function watchLogins() {
    const capture = () => {
      const pw = [...document.querySelectorAll('input[type="password"]')].find((p) => p.value && visible(p));
      if (!pw) return;
      const scope = pw.form || document;
      const users = [...scope.querySelectorAll("input")].filter((i) => ["text", "email", "tel", ""].includes(i.type) && i.value && visible(i));
      let user = users.find((i) => /username|email/.test(i.autocomplete || ""));
      if (!user) for (const i of users) if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) user = i;
      // Sign-up forms with "confirm password" count too; a single password field is a login.
      ask("offerSave", { url: location.origin, username: user?.value || "", password: pw.value }).catch(() => {});
    };
    document.addEventListener("submit", capture, true);
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.('button, input[type="submit"], [role="button"]');
      if (b && /sign ?in|log ?in|continue|next|submit|create account|sign ?up/i.test(textOf(b) || b.value || "")) capture();
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target?.type === "password") capture(); }, true);
  }

  async function maybeAskToSave() {
    if (window.top !== window && !window.__LOCKBOX_TEST__) return;   // one prompt per tab: top frame only
    const p = await ask("pendingSave").catch(() => null);
    if (!p) return;
    const answer = (a) => trusted(async () => {
      toast?.remove(); toast = null;
      await ask("answerSave", { answer: a }).catch((err) => showToast([el("div", {}, err.message)], 4000));
    });
    showToast([
      el("b", {}, p.update ? `Update saved password for ${p.host}?` : `Save login for ${p.host}?`),
      el("div", {}, p.username || "(no username)"),
      p.locked ? el("div", { style: "color:#fbbf24;margin-top:4px" }, "Unlock Lockbox first, then press Save.") : null,
      el("div", { class: "row" },
        el("button", { class: "btn primary", onclick: answer("save") }, p.update ? "Update" : "Save"),
        el("button", { class: "btn", onclick: answer("later") }, "Not now"),
        el("button", { class: "btn", onclick: answer("never") }, "Never here")),
    ]);
  }

  // ---------------------------------------------------------------- wiring

  document.addEventListener("focusin", async (e) => {
    const field = e.target;
    if (!isFillable(field) || host?.contains(field)) return;
    if (field.type === "search") return;
    activeField = field;
    if (!status) await refreshStatus();
    if (!status?.setup || status.inline === false) return;
    const application = looksLikeApplication();
    // Any real input counts: many sites have no <form> and label fields only with a placeholder
    // or aria-label. (Search boxes were already excluded above.)
    const formish = !!(field.form || labelFor(field) || field.placeholder || field.getAttribute("aria-label")
      || field.name || field.id || field.tagName === "TEXTAREA");
    const relevant = field.type === "password"
      || (status.unlocked && (status.siteLogins > 0 || (status.hasProfile && (application || formish))))
      || (!status.unlocked && (application || formish));      // locked: still show the badge, menu says "unlock"
    if (!relevant || activeField !== field) return;
    showBadge(field);
    if (status.unlocked && field.type !== "password" && application && status.hasProfile && !field.value) openMenu(field);
  }, true);

  // Close when focus leaves both the field and Lockbox's own UI. Focus inside our shadow root
  // (the menu's search box) shows up as document.activeElement === host.
  function closeIfFocusLeft() {
    setTimeout(() => {
      const a = document.activeElement;
      if (!activeField || a === activeField || (host && a === host)) return;
      hideBadge();
      closeMenu();
      activeField = null;
    }, 150);
  }

  document.addEventListener("focusout", (e) => {
    if (e.target === activeField) closeIfFocusLeft();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu) { closeMenu(); e.stopPropagation(); }
    if (e.key === "ArrowDown" && e.altKey && activeField) { e.preventDefault(); openMenu(activeField); }
  }, true);

  addEventListener("scroll", () => {
    if (activeField && badge) placeNear(badge, activeField);
    if (activeField && menu) placeNear(menu, activeField, { below: true });
  }, true);
  addEventListener("resize", () => closeMenu());

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "lockbox:ping") {          // popup self-check: "is the page helper alive here?"
      if (window.top === window || window.__LOCKBOX_TEST__) sendResponse({ ok: true, fields: document.querySelectorAll("input, textarea, select").length });
      return false;
    }
    if (msg?.type !== "lockbox:fillAll") return false;
    // Every frame hears this; only a frame that actually holds form fields answers, so an
    // application embedded in an iframe (e.g. Greenhouse on a company site) still gets filled.
    if (!collectFields().fields.length) return false;
    fillAll().then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  });

  chrome.storage?.onChanged?.addListener(() => { status = null; });
  addEventListener("focus", () => { status = null; });                 // e.g. you just unlocked in the popup

  watchLogins();
  maybeAskToSave();
  refreshStatus().then((s) => { if (s?.unlocked && s.hasProfile && looksLikeApplication()) showFab(); });
})();
