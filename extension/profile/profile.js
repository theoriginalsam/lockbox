// Work profile editor (full-page extension tab). Same schema as Nightshift's profile.yaml,
// stored encrypted in the vault. DOM built with textContent only.

import { emptyProfile, normalizeProfile } from "../src/jobfields.js";

const main = document.getElementById("main");
const saveBtn = document.getElementById("save");
const saveState = document.getElementById("save-state");
let profile = emptyProfile();
let resume = null;
let dirty = false;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || "Lockbox didn't respond");
  return res.data;
}

function markDirty() {
  dirty = true;
  saveState.textContent = "Unsaved changes";
}

/** Text input bound to obj[key]. */
function input(label, obj, key, { type = "text", wide = false, placeholder = "", area = false } = {}) {
  const el = area ? h("textarea", { placeholder }) : h("input", { type, placeholder });
  el.value = obj[key] ?? "";
  el.addEventListener("input", () => { obj[key] = el.value; markDirty(); });
  return h("label", { class: `f${wide ? " wide" : ""}` }, label, el);
}

function linesInput(label, getList, setList, placeholder) {
  const el = h("textarea", { placeholder });
  el.value = getList().join("\n");
  el.addEventListener("input", () => { setList(el.value.split("\n").map((s) => s.trim()).filter(Boolean)); markDirty(); });
  return h("label", { class: "f wide" }, label, el);
}

function card(title, hint, ...body) {
  return h("section", { class: "card" }, h("h2", {}, title), hint ? h("p", { class: "hint" }, hint) : null, ...body);
}

function listSection(title, hint, list, blank, renderEntry, addLabel) {
  const container = h("div");
  const draw = () => {
    container.replaceChildren(...list.map((item, i) => h("div", { class: "entry" },
      h("button", { class: "btn sm danger remove", type: "button", onclick: () => { list.splice(i, 1); markDirty(); draw(); } }, "Remove"),
      ...renderEntry(item, i))));
  };
  draw();
  return card(title, hint, container,
    h("button", { class: "btn sm", type: "button", onclick: () => { list.push(structuredClone(blank)); markDirty(); draw(); } }, addLabel));
}

// ---------------------------------------------------------------- sections

function importCard() {
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      profile = normalizeProfile(JSON.parse(await f.text()));
      markDirty();
      render();
      saveState.textContent = `Imported ${f.name}. Review it, then Save.`;
    } catch (err) {
      alert(`Couldn't import that file: ${err.message}`);
    }
  });
  const exportBtn = h("button", { class: "btn sm", type: "button", onclick: () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }));
    h("a", { href: url, download: "work-profile.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } }, "Export JSON");
  return card("Import", "Load your whole profile at once from Nightshift (run: nightshift export-lockbox > profile.json) or from a previous Lockbox export.",
    h("div", { class: "row" }, h("button", { class: "btn sm primary", type: "button", onclick: () => file.click() }, "Import profile JSON"), exportBtn, file));
}

function resumeCard() {
  const picker = h("input", { type: "file", accept: ".pdf,.doc,.docx", hidden: true });
  const status = h("div", { class: "row" });
  const drawStatus = () => status.replaceChildren(...(resume
    ? [h("span", { class: "pill" }, `📄 ${resume.name} · ${Math.round(resume.size / 1024)} KB`),
       h("button", { class: "btn sm danger", type: "button", onclick: async () => { await send("resumeRemove"); resume = null; drawStatus(); } }, "Remove")]
    : [h("span", { class: "muted" }, "No resume uploaded yet.")]));
  const upload = async (f) => {
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    try {
      await send("resumeUpload", { name: f.name, mime: f.type, b64: btoa(bin) });
      resume = { name: f.name, size: f.size };
      drawStatus();
    } catch (err) {
      alert(err.message);
    }
  };
  picker.addEventListener("change", () => upload(picker.files[0]));
  const drop = h("div", { class: "drop" }, "Drop your resume here, or ", h("button", { class: "btn sm", type: "button", onclick: () => picker.click() }, "choose a file"));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files[0]); });
  drawStatus();
  return card("Resume file", "Attached automatically to 'Resume/CV' upload fields. Stored encrypted on this device.", drop, h("div", { style: "height:10px" }), status, picker);
}

function contactCard() {
  const c = profile.contact;
  return card("Contact", null, h("div", { class: "grid" },
    input("Full name", c, "name"), input("Email", c, "email", { type: "email" }), input("Phone", c, "phone", { type: "tel" }),
    input("Location (City, State)", c, "location"), input("City", c, "city"), input("State / province", c, "state"),
    input("Country", c, "country"), input("Postal code", c, "postal_code"), input("Street address", c, "address"),
    input("LinkedIn URL", c, "linkedin", { type: "url" }), input("GitHub URL", c, "github", { type: "url" }),
    input("Website / portfolio", c, "website", { type: "url" })));
}

function aboutCard() {
  return card("About", null, h("div", { class: "grid" },
    input("Headline", profile, "headline", { wide: true, placeholder: "Machine Learning Engineer · Data Systems" }),
    input("Summary", profile, "summary", { wide: true, area: true, placeholder: "2–4 sentences about you" }),
    linesInput("Skills (one per line)", () => profile.skills, (v) => { profile.skills = v; }, "Python\nPyTorch\nSpark"),
    linesInput("Certifications (one per line)", () => profile.certifications, (v) => { profile.certifications = v; }, "")));
}

function experienceSection() {
  return listSection("Experience", "Most recent first: the first job is used for 'current company / title'.", profile.experience,
    { company: "", title: "", location: "", start: "", end: "", bullets: [] },
    (e) => [h("h3", {}, [e.title, e.company].filter(Boolean).join(" · ") || "New role"), h("div", { class: "grid" },
      input("Company", e, "company"), input("Title", e, "title"), input("Location", e, "location"),
      input("Start (e.g. 2023-01)", e, "start"), input("End (blank = Present)", e, "end"),
      linesInput("Bullets (one per line)", () => e.bullets.map((b) => b.text), (v) => { e.bullets = v.map((text) => ({ text })); }, "Built …"))],
    "+ Add role");
}

function educationSection() {
  return listSection("Education", null, profile.education,
    { school: "", degree: "", field: "", start: "", end: "", gpa: "", details: [] },
    (e) => [h("h3", {}, e.school || "New school"), h("div", { class: "grid" },
      input("School", e, "school"), input("Degree", e, "degree"), input("Field of study", e, "field"),
      input("Start", e, "start"), input("End / graduation", e, "end"), input("GPA (optional)", e, "gpa"))],
    "+ Add education");
}

function projectsSection() {
  return listSection("Projects", null, profile.projects, { name: "", link: "", bullets: [] },
    (p) => [h("h3", {}, p.name || "New project"), h("div", { class: "grid" },
      input("Name", p, "name"), input("Link", p, "link", { type: "url" }),
      linesInput("Bullets (one per line)", () => p.bullets.map((b) => b.text), (v) => { p.bullets = v.map((text) => ({ text })); }, ""))],
    "+ Add project");
}

function answersCard() {
  const a = profile.answers;
  const eeo = h("select", {}, h("option", { value: "decline" }, "Choose 'decline to answer'"), h("option", { value: "manual" }, "Leave for me to answer"));
  eeo.value = a.eeo === "decline" ? "decline" : "manual";
  eeo.addEventListener("change", () => { a.eeo = eeo.value; markDirty(); });

  const qaWrap = h("div");
  const drawQa = () => {
    const rows = Object.entries(a.custom).map(([q, ans]) => {
      const qIn = h("input", { placeholder: "Phrase in the question, e.g. security clearance" });
      const aIn = h("textarea", { placeholder: "Your answer", style: "min-height:40px" });
      qIn.value = q;
      aIn.value = ans;
      const commit = () => {
        const entries = Object.entries(a.custom).map(([k, v]) => (k === q ? [qIn.value, aIn.value] : [k, v]));
        a.custom = Object.fromEntries(entries.filter(([k]) => k !== ""));
        q = qIn.value;
        markDirty();
      };
      qIn.addEventListener("change", commit);
      aIn.addEventListener("input", commit);
      return h("div", { class: "qa" }, qIn, aIn,
        h("button", { class: "btn sm danger", type: "button", onclick: () => { delete a.custom[q]; markDirty(); drawQa(); } }, "✕"));
    });
    qaWrap.replaceChildren(...rows);
  };
  drawQa();
  return card("Application answers", "Used for the questions almost every application asks.", h("div", { class: "grid two" },
    input("Authorized to work (Yes/No)", a, "work_authorization"), input("Need visa sponsorship (Yes/No)", a, "needs_sponsorship"),
    input("Willing to relocate", a, "willing_to_relocate"), input("Salary expectation", a, "salary_expectation"),
    input("Earliest start / notice period", a, "earliest_start"), input("How did you hear about us", a, "how_did_you_hear"),
    input("Years of experience (blank = computed)", a, "years_experience"), input("Pronouns", a, "pronouns"),
    h("label", { class: "f" }, "EEO / demographic questions", eeo)),
    h("h2", { style: "margin-top:20px;font-size:15px" }, "Saved answers"),
    h("p", { class: "hint" }, "If a question contains the phrase, Lockbox fills your answer. Also searchable from the tap-a-field menu."),
    qaWrap,
    h("button", { class: "btn sm", type: "button", onclick: () => { a.custom[`new question ${Object.keys(a.custom).length + 1}`] = ""; markDirty(); drawQa(); } }, "+ Add answer"));
}

// ---------------------------------------------------------------- shell

function render() {
  main.replaceChildren(
    h("div", { class: "banner" }, "Fill a whole application: open it and press ", h("code", {}, "⌘/Ctrl+Shift+Y"),
      ", click Lockbox → Fill application, or the blue Fill button on the page. Tap any field for a menu of your details. Lockbox never submits for you."),
    importCard(), resumeCard(), contactCard(), aboutCard(), experienceSection(), educationSection(), projectsSection(), answersCard());
}

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    await send("jobProfileSave", { profile });
    dirty = false;
    saveState.textContent = `Saved ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    saveState.textContent = err.message === "locked" ? "Locked: unlock Lockbox from the toolbar, then Save again." : err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

(async () => {
  try {
    const data = await send("jobProfileGet");
    profile = normalizeProfile(data.profile);
    resume = data.resume;
    render();
  } catch (err) {
    saveBtn.hidden = true;
    main.replaceChildren(h("div", { class: "locked" }, h("h2", {}, "Lockbox is locked"),
      h("p", {}, err.message === "locked" ? "Unlock it from the toolbar icon, then reload this page." : err.message),
      h("button", { class: "btn", onclick: () => location.reload() }, "Reload")));
  }
})();
