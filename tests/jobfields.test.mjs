import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classify, matchOption, normalizeProfile, profileFacts, suggest, yearsOfExperience,
} from "../extension/src/jobfields.js";

const NOW = new Date(2026, 9, 28);
const profile = normalizeProfile({
  contact: { name: "Alex Q Example", email: "alex@example.test", phone: "+1 555 0100", location: "Austin, TX",
    linkedin: "https://linkedin.com/in/alex-example", github: "https://github.com/alex-example", website: "" },
  headline: "ML engineer", summary: "I build data systems.",
  experience: [
    { company: "Acme AI", title: "ML Engineer", location: "Remote", start: "2023-01", end: "Present", bullets: [{ text: "Built X" }] },
    { company: "DataCo", title: "Data Analyst", location: "Austin", start: "Jun 2020", end: "Feb 2023", bullets: ["Did Y"] },
  ],
  education: [{ school: "State University", degree: "M.S.", field: "Computer Science", start: "2018", end: "May 2020" }],
  skills: ["Python", "Spark"],
  answers: { work_authorization: "Yes", needs_sponsorship: "No", salary_expectation: "Open", eeo: "decline",
    custom: { "security clearance": "No", "why do you want": "Because of the mission." } },
});

const f = (label, extra = {}) => ({ label, type: "text", ...extra });

test("contact and name fields", () => {
  assert.equal(classify(f("First Name *"), profile).value, "Alex");
  assert.equal(classify(f("Last name"), profile).value, "Example");
  assert.equal(classify(f("Full name"), profile).value, "Alex Q Example");
  assert.equal(classify(f("Email", { type: "email" }), profile).value, "alex@example.test");
  assert.equal(classify(f("Phone"), profile).value, "+1 555 0100");
  assert.equal(classify(f("LinkedIn Profile"), profile).value, "https://linkedin.com/in/alex-example");
  assert.equal(classify(f("Website / Portfolio"), profile).value, "https://github.com/alex-example");
  assert.equal(classify({ label: "", name: "job_application[first_name]", type: "text" }, profile).value, "Alex");
  assert.equal(classify({ label: "", autocomplete: "family-name", type: "text" }, profile).value, "Example");
});

test("never puts your own details into questions about someone else", () => {
  assert.equal(classify(f("Referrer name"), profile), null);
  assert.equal(classify(f("Emergency contact phone"), profile), null);
  assert.equal(classify(f("Who referred you? Email", { type: "email" }), profile), null);
});

test("work questions, with yes/no options mapped to the right choice", () => {
  const sponsor = { label: "Will you now or in the future require sponsorship?", type: "select",
    options: ["Select...", "Yes", "No"] };
  assert.equal(classify(sponsor, profile).value, "No");
  const auth = { label: "Are you legally authorized to work in the United States?", type: "radio",
    options: ["Yes, I am authorized", "No"] };
  assert.equal(classify(auth, profile).value, "Yes, I am authorized");
  assert.equal(classify(f("Current company"), profile).value, "Acme AI");
  assert.equal(classify(f("Current job title"), profile).value, "ML Engineer");
  assert.equal(classify(f("Desired salary"), profile).value, "Open");
  assert.equal(classify(f("Do you have an active security clearance?"), profile).value, "No");
});

test("EEO questions pick the decline option, never guess", () => {
  const gender = { label: "Gender", type: "select", options: ["Male", "Female", "Decline to self-identify"] };
  assert.equal(classify(gender, profile).value, "Decline to self-identify");
  const vet = { label: "Veteran status", type: "select", options: ["I am a veteran", "I am not a veteran"] };
  assert.equal(classify(vet, profile), null, "no decline option -> leave it for the user");
});

test("education and experience-derived values", () => {
  assert.equal(classify(f("School"), profile).value, "State University");
  assert.equal(classify(f("Field of study"), profile).value, "Computer Science");
  assert.equal(classify(f("Graduation year"), profile).value, "2020");
  assert.equal(yearsOfExperience(profile, NOW), "6");       // Jun 2020 -> Oct 2026, overlap-free
  assert.equal(classify({ label: "Resume/CV", type: "file" }, profile).value, "__resume__");
  assert.equal(classify({ label: "Cover letter", type: "file" }, profile), null);
});

test("unknown questions are left alone; option matching basics", () => {
  assert.equal(classify(f("What is your favorite color?"), profile), null);
  assert.equal(classify({ label: "Password", type: "password" }, profile), null);
  assert.equal(matchOption(["Select...", "United States", "Nepal"], "nepal"), "Nepal");
  assert.equal(matchOption(["Yes", "No"], "maybe"), null);
});

test("tap-a-field suggestions rank the classifier's pick first and include job details", () => {
  const s = suggest(f("Company name"), profile);
  assert.equal(s[0].best, true);
  assert.equal(s[0].value, "Acme AI");
  assert.ok(s.some((x) => x.value === "DataCo"), "other jobs' companies are offered too");
  const facts = profileFacts(profile);
  assert.ok(facts.some((x) => x.label.startsWith("Job 1") && x.label.endsWith("description")));
  assert.ok(facts.some((x) => x.label === "Answer · why do you want"));
});

test("computed answers: age, date of birth in the field's format, 18+, age ranges, today", async () => {
  const { ageOn, formatForField, rangeOption } = await import("../extension/src/jobfields.js");
  const now = new Date(2026, 9, 28);
  assert.equal(ageOn("1999-11-02", now), 26, "birthday not reached yet this year");
  assert.equal(ageOn("1999-10-28", now), 27, "birthday today");
  assert.equal(ageOn("", now), null);

  const p = normalizeProfile({ contact: { name: "A B", date_of_birth: "1999-10-28" } });
  const age = Number(classify(f("Age"), p).value);
  assert.ok(age >= 26, "age computed from date of birth");
  assert.equal(classify(f("Date of Birth", { type: "date" }), p).value, "1999-10-28");
  assert.equal(classify(f("Date of birth", { placeholder: "MM/DD/YYYY" }), p).value, "10/28/1999");
  assert.equal(classify(f("Birth date (DD/MM/YYYY)"), p).value, "28/10/1999");
  assert.equal(classify({ label: "Are you at least 18 years of age?", type: "select", options: ["Yes", "No"] }, p).value, "Yes");
  assert.equal(rangeOption(["Under 18", "18-24", "25 - 34", "35+"], 27), "25 - 34");
  assert.equal(rangeOption(["Under 18", "18-24", "25-34", "35 or older"], 40), "35 or older");
  assert.match(classify(f("Today's date", { type: "date" }), p).value, /^\d{4}-\d{2}-\d{2}$/);

  const noDob = normalizeProfile({ contact: { name: "A B" } });
  assert.equal(classify(f("Age"), noDob), null, "no date of birth -> never guess an age");
  assert.equal(classify(f("Referrer's date of birth"), p), null, "someone else's birthday is left alone");
  assert.equal(classify(f("Preferred language"), p)?.key, undefined, "'language' must not match 'age'");
  assert.equal(formatForField(null, {}), "");
});
