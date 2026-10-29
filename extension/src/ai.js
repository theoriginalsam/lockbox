// AI drafting through OpenRouter (https://openrouter.ai/docs): one key, many models.
// Only called when you click "Draft with AI"; sends your work profile, the question and the
// visible job-posting text to the model you chose.

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "openrouter/auto";

export const SYSTEM_PROMPT = `You write answers to job-application questions for the candidate whose profile is given.

Rules:
- Use only facts from the candidate's profile. Never invent employers, titles, dates, degrees, numbers, skills or achievements.
- Write in the candidate's first-person voice: specific, warm, professional. No clichés ("I am passionate about…", "dynamic team player").
- Tie the answer to the company and role when the job posting gives you details; never invent facts about the company.
- Length: 60-150 words for open questions unless the question or its field asks for something shorter; one line for short fields.
- Plain text only: no markdown, no headings, no surrounding quotes.
- If the question asks for a fact the profile doesn't contain (current salary, a referral, a clearance, a date), reply exactly: NEEDS_INPUT: <what the candidate must provide>`;

/** Compact profile text: fewer tokens than raw JSON and easier for the model to cite. */
export function profileForPrompt(p) {
  const lines = [];
  const c = p.contact || {};
  lines.push(`Name: ${c.name}`, `Location: ${c.location || [c.city, c.state, c.country].filter(Boolean).join(", ")}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.summary) lines.push(`Summary: ${p.summary}`);
  for (const e of p.experience || []) {
    lines.push(`\nRole: ${e.title} at ${e.company} (${e.start} – ${e.end || "Present"}${e.location ? `, ${e.location}` : ""})`);
    for (const b of e.bullets || []) lines.push(`- ${b.text}`);
  }
  for (const pr of p.projects || []) {
    lines.push(`\nProject: ${pr.name}${pr.link ? ` (${pr.link})` : ""}`);
    for (const b of pr.bullets || []) lines.push(`- ${b.text}`);
  }
  for (const ed of p.education || []) {
    lines.push(`\nEducation: ${ed.degree} in ${ed.field}, ${ed.school} (${ed.start} – ${ed.end})${ed.gpa ? `, GPA ${ed.gpa}` : ""}`);
  }
  if (p.skills?.length) lines.push(`\nSkills: ${p.skills.join(", ")}`);
  if (p.certifications?.length) lines.push(`Certifications: ${p.certifications.join(", ")}`);
  const a = p.answers || {};
  const known = Object.entries({ "Work authorization": a.work_authorization, "Needs sponsorship": a.needs_sponsorship,
    "Willing to relocate": a.willing_to_relocate, "Earliest start": a.earliest_start }).filter(([, v]) => v);
  if (known.length) lines.push(`\nStandard answers: ${known.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  for (const [q, ans] of Object.entries(a.custom || {})) lines.push(`Saved answer to "${q}": ${ans}`);
  return lines.join("\n");
}

export function buildMessages(profile, field, page) {
  const question = [field.label, field.placeholder].filter(Boolean).join(" — ") || field.name || "this field";
  const short = field.type !== "textarea";
  const posting = String(page?.text || "").slice(0, 6000);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content:
      `CANDIDATE PROFILE\n${profileForPrompt(profile)}\n\n`
      + `JOB PAGE: ${page?.title || ""} (${page?.host || ""})\n${posting ? `POSTING TEXT (may include form labels):\n${posting}\n\n` : "\n"}`
      + `QUESTION: ${question}\n`
      + (short ? "This is a single-line field: answer in one short line.\n" : "")
      + (page?.existing ? `The candidate's current draft (improve it, keep their facts): ${page.existing}\n` : "")
      + "Write the answer now." },
  ];
}

export async function draftAnswer({ apiKey, model, profile, field, page, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Add your OpenRouter API key in Lockbox → Settings → AI drafting");
  let res;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://samirpoudel.com.np",   // OpenRouter app attribution (optional)
        "X-Title": "Lockbox",
      },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, messages: buildMessages(profile, field, page),
        max_tokens: 700, temperature: 0.4 }),
    });
  } catch {
    throw new Error("Couldn't reach OpenRouter");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenRouter error ${res.status}`;
    throw new Error(res.status === 401 ? "OpenRouter rejected the API key" : res.status === 402 ? "OpenRouter: out of credits" : msg);
  }
  const text = String(data?.choices?.[0]?.message?.content || "").trim().replace(/^["“]|["”]$/g, "");
  if (!text) throw new Error("The model returned an empty answer; try again or pick another model");
  const needs = text.match(/^NEEDS_INPUT:\s*(.+)/s);
  return needs ? { needsInput: needs[1].trim(), model: data.model } : { text, model: data.model };
}
