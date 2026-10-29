# Job applications

Filling applications is what Lockbox is mainly for. You keep one **work profile**, and Lockbox fills
application forms from it, either all at once or one field at a time. It never submits a form for you.

## 1. Set up your work profile

Popup → **Work profile** opens the editor in a tab.

| Section | What goes in it |
| --- | --- |
| Resume | Drop your resume PDF. Lockbox attaches it to "Resume/CV" upload fields. |
| Contact | Name, email, phone, location, LinkedIn, GitHub, website, **date of birth** |
| About | Headline and summary |
| Experience, Education, Projects | One entry each, with dates and bullet points |
| Application answers | Work authorization, sponsorship, relocation, salary, earliest start date, EEO preference |
| Custom Q&A | Your saved answers to questions that keep coming up ("Why this company?", "Security clearance?") |

Click **Save profile** when you're done.

**Import instead of typing:** *Import profile JSON* takes a profile file in the same format as Nightshift's
`profile.yaml`. If you use Nightshift, `nightshift export-lockbox > profile.json` produces one.

## 2. Fill a whole application

On an application page, use any of these:

- the **Fill application** button at the bottom right of the page,
- popup → **Fill application**,
- the keyboard shortcut **⌘⇧Y** (Mac) or **Ctrl+Shift+Y** (Windows).

Lockbox then:

- fills every field it recognises, including the resume upload, dropdowns, yes/no radio questions,
  and "Decline to self-identify" on EEO questions,
- outlines filled fields in **green** and fields that still need you in **yellow**,
- shows a summary listing what's left. Click an item in the list to jump to that field.

It doesn't overwrite anything you've already typed, and it never clicks Submit.

## 3. Fill one field at a time

Click any field: a small Lockbox badge appears at its right edge. Click the badge, or press
**Alt+↓**, to open the menu. On known job sites (Greenhouse, Lever, Ashby, Workday and others) the
menu opens by itself.

- The best match comes first, marked with a green dot.
- Type in the search box to find anything in your profile: a past job title, a project link, a
  graduation date.
- Use **↑ ↓** to move and **Enter** to pick.

## Computed answers

These are worked out from your date of birth and today's date, so they're always current:

| Question | Answer |
| --- | --- |
| Age | Your age today |
| Date of birth | In the field's format: date pickers get a date; text boxes get `MM/DD/YYYY`, or `DD/MM/YYYY` if the box asks for it |
| Are you at least 18? | Yes |
| Age range (18-24, 25-34, …) | The bracket that contains your age |
| Today's date | Today's date |
| Years of experience | Counted from your experience dates, without double-counting overlapping jobs |

Without a date of birth, Lockbox leaves age questions blank rather than guessing.

## What Lockbox never does

- Puts your details into questions about **someone else**, such as "Referrer name" or
  "Emergency contact phone".
- Guesses EEO answers. If there's no decline option, it leaves the question for you.
- Fills profile data into a form that has a password field, such as a login form.

## AI drafting

For open questions ("Why do you want to work here?"), Lockbox can write a first draft.

1. Create an API key at [openrouter.ai](https://openrouter.ai/keys). A separate key with a credit
   limit is safest.
2. In Lockbox → ⚙ Settings → **AI drafting**, paste the key. It's stored encrypted in your vault.
   Optionally pick a model; `openrouter/auto` is the default.
3. Turn on **AI drafting** on the popup's front page.
4. In an application, click a written-answer field, open the menu, and choose **Draft with AI**.
   Then **Insert**, **Try again** or **Cancel**.

What gets sent: your work profile, the question, and the visible text of the job page, to the model
you chose through OpenRouter. The model is told to use only facts from your profile. If the
question needs something your profile doesn't have (a referral name, your current salary), it
says so instead of making something up.

Always read a draft before you submit it.
