// Job-application field classifier: given a description of one form field, decide which piece
// of the work profile belongs in it. Pure functions (no DOM), shared by fill-everything and the
// tap-a-field menu, and unit-tested in node.
//
// The profile uses Nightshift's profile.yaml schema (contact, headline, summary, experience,
// projects, education, skills, certifications, answers{..., custom}) so one profile drives both.
//
// field = { label, name, id, placeholder, autocomplete, type, options: [string], required }

export const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (answer|disclose|say)|choose not|rather not/i;
const EEO = /\b(gender|sex\b|race|ethnicity|hispanic|latin|veteran|disability|disabled|sexual orientation|transgender|lgbt)/i;
// Questions about *other* people: never put the candidate's own details here.
const SOMEONE_ELSE = /referr|referral|emergency|reference|manager|supervisor|recruiter|spouse|parent|guardian|who told/i;

export function emptyProfile() {
  return {
    contact: { name: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "",
      city: "", state: "", country: "", postal_code: "", address: "" },
    headline: "", summary: "",
    experience: [], projects: [], education: [], skills: [], certifications: [],
    answers: {
      work_authorization: "Yes", needs_sponsorship: "No", willing_to_relocate: "Yes",
      salary_expectation: "", earliest_start: "Two weeks after offer", how_did_you_hear: "",
      years_experience: "", pronouns: "", eeo: "decline", custom: {},
    },
  };
}

/** Accept Nightshift's export (or a partial profile) and fill in anything missing. */
export function normalizeProfile(raw) {
  const base = emptyProfile();
  const p = raw?.profile || raw || {};
  const text = (v) => (v == null ? "" : String(v).trim());
  const bullets = (b) => (Array.isArray(b) ? b.map((x) => ({ text: text(x?.text ?? x) })).filter((x) => x.text) : []);
  return {
    contact: Object.fromEntries(Object.keys(base.contact).map((k) => [k, text(p.contact?.[k])])),
    headline: text(p.headline),
    summary: text(p.summary),
    experience: (p.experience || []).map((e) => ({ company: text(e.company), title: text(e.title),
      location: text(e.location), start: text(e.start), end: text(e.end), bullets: bullets(e.bullets) })),
    projects: (p.projects || []).map((e) => ({ name: text(e.name), link: text(e.link), bullets: bullets(e.bullets) })),
    education: (p.education || []).map((e) => ({ school: text(e.school), degree: text(e.degree), field: text(e.field),
      start: text(e.start), end: text(e.end), gpa: text(e.gpa), details: (e.details || []).map(text).filter(Boolean) })),
    skills: (p.skills || []).map(text).filter(Boolean),
    certifications: (p.certifications || []).map(text).filter(Boolean),
    answers: {
      ...base.answers,
      ...Object.fromEntries(Object.keys(base.answers).filter((k) => k !== "custom")
        .map((k) => [k, p.answers?.[k] == null ? base.answers[k] : text(p.answers[k])])),
      custom: Object.fromEntries(Object.entries(p.answers?.custom || {}).map(([k, v]) => [text(k), text(v)]).filter(([k]) => k)),
    },
  };
}

// ---------------------------------------------------------------- derived values

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseMonth(s, now = new Date()) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  if (/present|current|now|ongoing/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  let m = t.match(/(\d{4})[-/.](\d{1,2})/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = t.match(/(\d{1,2})[-/.](\d{4})/);
  if (m) return Number(m[2]) * 12 + Number(m[1]) - 1;
  m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && MONTHS[m[1]]) return Number(m[2]) * 12 + MONTHS[m[1]] - 1;
  m = t.match(/(\d{4})/);
  return m ? Number(m[1]) * 12 : null;
}

/** Total years across roles, overlapping periods counted once. */
export function yearsOfExperience(profile, now = new Date()) {
  if (profile.answers.years_experience) return profile.answers.years_experience;
  const spans = profile.experience.map((e) => [parseMonth(e.start, now), parseMonth(e.end || "present", now)])
    .filter(([a, b]) => a != null && b != null && b >= a).sort((x, y) => x[0] - y[0]);
  let months = 0, curStart = null, curEnd = null;
  for (const [a, b] of spans) {
    if (curEnd == null || a > curEnd) {
      if (curEnd != null) months += curEnd - curStart;
      curStart = a; curEnd = b;
    } else curEnd = Math.max(curEnd, b);
  }
  if (curEnd != null) months += curEnd - curStart;
  return months ? String(Math.floor(months / 12)) : "";
}

function names(profile) {
  const parts = profile.contact.name.split(/\s+/).filter(Boolean);
  return { full: parts.join(" "), first: parts[0] || "", last: parts.length > 1 ? parts[parts.length - 1] : "",
    middle: parts.slice(1, -1).join(" ") };
}

function year(s) {
  return (String(s || "").match(/\d{4}/) || [""])[0];
}

// ---------------------------------------------------------------- rules

const cur = (p) => p.experience[0] || {};
const edu = (p) => p.education[0] || {};

// [key, human label, test on the field's combined text, value(profile)]
// Ordered most-specific first; the first rule that matches and has a value wins.
const RULES = [
  ["preferredName", "Preferred name", /preferred (first )?name|nickname/, (p) => names(p).first, "person"],
  ["firstName", "First name", /first.?name|given.?name|\bfname\b|forename/, (p) => names(p).first, "person"],
  ["lastName", "Last name", /last.?name|family.?name|surname|\blname\b/, (p) => names(p).last, "person"],
  ["middleName", "Middle name", /middle.?name/, (p) => names(p).middle, "person"],
  ["fullName", "Full name", /^(your |full |legal |candidate )?name\b|^full.?name|\bfull.?name\b|^name$/, (p) => names(p).full, "person"],
  ["email", "Email", /e-?mail/, (p) => p.contact.email, "person"],
  ["phone", "Phone", /phone|mobile|cell\b|telephone|\btel\b/, (p) => p.contact.phone, "person"],
  ["linkedin", "LinkedIn", /linked.?in/, (p) => p.contact.linkedin],
  ["github", "GitHub", /github/, (p) => p.contact.github],
  ["website", "Website", /website|portfolio|personal (site|url|page)|blog|\burl\b/, (p) => p.contact.website || p.contact.github],
  ["postalCode", "Postal code", /zip|postal|post.?code/, (p) => p.contact.postal_code],
  ["address", "Street address", /street|address.?(line)?.?1|^address$/, (p) => p.contact.address],
  ["city", "City", /\bcity\b|\btown\b/, (p) => p.contact.city || p.contact.location.split(",")[0]?.trim()],
  ["state", "State", /\bstate\b|province|region/, (p) => p.contact.state],
  ["country", "Country", /\bcountry\b/, (p) => p.contact.country],
  ["location", "Location", /location|where (are you|do you) (based|live)|current(ly)? (based|located)|city.{0,5}state/, (p) => p.contact.location],
  ["currentCompany", "Current company", /current.{0,12}(company|employer|organi[sz]ation)|^(company|employer)( name)?$|most recent (company|employer)/, (p) => cur(p).company],
  ["currentTitle", "Current title", /current.{0,12}(title|role|position)|job title|^title$|most recent (title|role)/, (p) => cur(p).title],
  ["yearsExperience", "Years of experience", /years? of (professional |relevant |work )?experience|how many years/, (p) => yearsOfExperience(p)],
  ["sponsorship", "Needs sponsorship", /sponsor/, (p) => p.answers.needs_sponsorship],
  ["workAuth", "Work authorization", /authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible|able)|eligib.{0,20}work|right to work/, (p) => p.answers.work_authorization],
  ["relocate", "Willing to relocate", /relocat/, (p) => p.answers.willing_to_relocate],
  ["salary", "Salary expectation", /salary|compensation|pay (expectation|requirement)|desired pay/, (p) => p.answers.salary_expectation],
  ["startDate", "Earliest start", /start date|when can you start|earliest|availability|notice period|available to start/, (p) => p.answers.earliest_start],
  ["source", "How did you hear", /how did you (hear|find|learn)|where did you (hear|find)|source/, (p) => p.answers.how_did_you_hear],
  ["pronouns", "Pronouns", /pronoun/, (p) => p.answers.pronouns],
  ["school", "School", /school|university|college|institution/, (p) => edu(p).school],
  ["degree", "Degree", /\bdegree\b|qualification|level of education|highest education/, (p) => edu(p).degree],
  ["major", "Field of study", /major|field of study|discipline|concentration|area of study/, (p) => edu(p).field],
  ["gpa", "GPA", /\bgpa\b|grade point/, (p) => edu(p).gpa],
  ["graduation", "Graduation year", /graduat|completion (date|year)|year of (completion|graduation)/, (p) => year(edu(p).end)],
  ["headline", "Headline", /headline|tagline|professional title/, (p) => p.headline],
  ["summary", "Summary", /summary|about (you|yourself)|tell us about yourself|bio\b|introduce yourself/, (p) => p.summary],
  ["skills", "Skills", /skills|technologies|tech stack|tools you/, (p) => p.skills.join(", ")],
  ["certifications", "Certifications", /certification|licen[cs]e/, (p) => p.certifications.join(", ")],
];

const RULE_BY_KEY = Object.fromEntries(RULES.map((r) => [r[0], r]));

function fieldText(f) {
  return [f.label, f.name, f.id, f.placeholder, f.ariaLabel].filter(Boolean).join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-[\]]+/g, " ").toLowerCase();
}

const AUTOCOMPLETE = {
  "given-name": "firstName", "family-name": "lastName", "additional-name": "middleName", name: "fullName",
  email: "email", tel: "phone", "tel-national": "phone", "postal-code": "postalCode", "address-line1": "address",
  "street-address": "address", "address-level2": "city", "address-level1": "state", country: "country",
  "country-name": "country", organization: "currentCompany", "organization-title": "currentTitle", url: "website",
};

/** Pick the option that best expresses `value` (exact, prefix, yes/no meaning, or contains). */
export function matchOption(options, value) {
  const opts = (options || []).filter((o) => String(o).trim() && !/^(select|choose|please select|--)/i.test(o));
  const v = String(value || "").trim().toLowerCase();
  if (!opts.length || !v) return null;
  const norm = (o) => String(o).trim().toLowerCase();
  const exact = opts.find((o) => norm(o) === v);
  if (exact) return exact;
  const yes = /^(yes|y|true)\b/.test(v), no = /^(no|n|false)\b/.test(v);
  if (yes) return opts.find((o) => /^yes\b/i.test(o.trim())) || null;
  if (no) return opts.find((o) => /^no\b/i.test(o.trim())) || null;
  if (v === "decline") return opts.find((o) => DECLINE.test(o)) || null;
  return opts.find((o) => norm(o).startsWith(v)) || opts.find((o) => norm(o).includes(v))
    || opts.find((o) => v.includes(norm(o)) && norm(o).length > 2) || null;
}

/**
 * Best value for one field: { key, label, value } or null when unsure.
 * For select/radio fields the value is always one of the field's options.
 */
export function classify(field, profile) {
  if (["password", "hidden", "submit", "button", "search"].includes(field.type)) return null;
  const text = fieldText(field);
  const label = String(field.label || "").toLowerCase();
  const choice = ["select", "radio", "combobox"].includes(field.type);
  const finish = (key, lbl, value) => {
    if (!value) return null;
    if (choice) {
      const opt = matchOption(field.options, value);
      return opt ? { key, label: lbl, value: opt } : null;
    }
    return { key, label: lbl, value };
  };

  if (field.type === "file") {
    return /resume|\bcv\b|curriculum/.test(text) ? { key: "resume", label: "Resume (PDF)", value: "__resume__" } : null;
  }
  if (EEO.test(label || text) && profile.answers.eeo === "decline") {
    return finish("eeo", "EEO: decline to answer", "decline");
  }
  for (const [phrase, answer] of Object.entries(profile.answers.custom)) {
    if (phrase && text.includes(phrase.toLowerCase())) {
      const r = finish(`custom:${phrase}`, phrase, answer);
      if (r) return r;
    }
  }
  const auto = AUTOCOMPLETE[String(field.autocomplete || "").replace(/^(section-\S+ )?(shipping |billing )?/, "")];
  if (auto && !SOMEONE_ELSE.test(text)) {
    const [, lbl, , fn] = RULE_BY_KEY[auto];
    const r = finish(auto, lbl, fn(profile));
    if (r) return r;
  }
  if (field.type === "email" && !SOMEONE_ELSE.test(text)) return finish("email", "Email", profile.contact.email);
  if (field.type === "tel" && !SOMEONE_ELSE.test(text)) return finish("phone", "Phone", profile.contact.phone);
  for (const [key, lbl, test, fn, scope] of RULES) {
    if (!test.test(text)) continue;
    if (scope === "person" && SOMEONE_ELSE.test(text)) return null;
    const r = finish(key, lbl, fn(profile));
    if (r) return r;
  }
  return null;
}

// ---------------------------------------------------------------- tap-a-field suggestions

/** Every useful piece of the profile as {label, value}, for the searchable menu. */
export function profileFacts(profile) {
  const facts = [];
  const add = (label, value) => { if (value) facts.push({ label, value: String(value) }); };
  for (const [key, lbl, , fn] of RULES) add(lbl, fn(profile));
  profile.experience.forEach((e, i) => {
    const n = `Job ${i + 1} · ${e.company}`;
    add(`${n} · title`, e.title); add(`${n} · company`, e.company); add(`${n} · location`, e.location);
    add(`${n} · start`, e.start); add(`${n} · end`, e.end || "Present");
    add(`${n} · description`, e.bullets.map((b) => `• ${b.text}`).join("\n"));
  });
  profile.education.forEach((e, i) => {
    const n = `Education ${i + 1} · ${e.school}`;
    add(`${n} · degree`, e.degree); add(`${n} · field`, e.field); add(`${n} · start`, e.start); add(`${n} · end`, e.end);
  });
  profile.projects.forEach((p) => add(`Project · ${p.name}`, [p.link, ...p.bullets.map((b) => `• ${b.text}`)].filter(Boolean).join("\n")));
  for (const [q, a] of Object.entries(profile.answers.custom)) add(`Answer · ${q}`, a);
  const seen = new Set();
  return facts.filter((f) => (seen.has(f.label + f.value) ? false : seen.add(f.label + f.value)));
}

/** Ranked suggestions for a focused field: the classifier's pick first, then label-similar facts. */
export function suggest(field, profile, limit = 8) {
  const best = classify(field, profile);
  const words = new Set(fieldText(field).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const scored = profileFacts(profile).map((f) => {
    const fw = f.label.toLowerCase().split(/[^a-z0-9]+/);
    return { ...f, score: fw.filter((w) => words.has(w)).length };
  }).filter((f) => !best || f.value !== best.value).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit - (best ? 1 : 0)).map(({ label, value }) => ({ label, value }));
  return best && best.value !== "__resume__" ? [{ label: best.label, value: best.value, best: true }, ...top] : top;
}
