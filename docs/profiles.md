# Profiles

A **profile** is a named set of form details: name, email, phone, **date of birth**, company,
address, and free-text **notes**. Keep as many as you like, for example **Personal** for rental,
bank and government forms. They're separate from your [work profile](job-applications.md), which
stays untouched.

## Create one

1. Popup → **Profiles** tab → **+ New**.
2. Give it a name, such as `Personal`.
3. Fill the boxes. Date of birth uses a date picker.
4. Put everything else in **Notes**: education, document numbers, family details. Notes are only
   stored (encrypted) and shown to you, never filled into a page.
5. **Save**.

## Import from a JSON file

At the bottom of the profile form, open **Import from JSON**, paste the file's contents, and click
**Fill from JSON**. Check the boxes, then **Save**.

Two shapes work:

```json
{ "givenName": "Alex", "familyName": "Example", "email": "alex@example.test", "dateOfBirth": "1995-07-04",
  "city": "Austin", "state": "TX", "country": "United States" }
```

```json
{
  "basic_information": {
    "full_name": "Alex Q Example", "date_of_birth": "1995-07-04", "phone": "+1 555 0100",
    "email": "alex@example.test",
    "location": { "city": "Austin", "state": "TX", "country": "United States" }
  },
  "education": [{ "degree": "M.S.", "field": "Computer Science", "institution": "State University" }],
  "timeline": [{ "date": "2020-05", "event": "Graduated" }]
}
```

In the second shape, the contact fields fill the boxes and every other section (education,
timeline and so on) becomes readable text in **Notes**. Dates must be `YYYY-MM-DD`. If the name is
empty, it's set to `Personal`.

The JSON file itself isn't encrypted, so delete it once the profile is saved in Lockbox.

## Fill a form

Open the form, then popup → **Profiles** → **Fill form** next to the profile. Lockbox matches
fields by their standard `autocomplete` hints first (`given-name`, `bday`, `postal-code`, …), then
by their labels. Date of birth goes into date pickers as a date, and into text boxes as
`MM/DD/YYYY`, or `DD/MM/YYYY` when the box asks for it.

Profiles are never filled into a form that contains a password field.
