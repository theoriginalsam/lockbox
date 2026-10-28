// Functions injected into the active tab with chrome.scripting.executeScript (isolated world).
// Each must be fully self-contained: Chrome serialises the function source, not its closure.

export function fillLoginInPage(username, password) {
  const visible = (el) => {
    const style = getComputedStyle(el);
    return el.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none"
      && !el.disabled && !el.readOnly;
  };
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    el.focus();
    setter.call(el, value);          // works with React/Vue controlled inputs
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  };
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  const scope = passwords[0]?.form || document;
  const textish = [...scope.querySelectorAll("input")].filter((el) =>
    visible(el) && ["text", "email", "tel", ""].includes(el.type));
  let user = textish.find((el) => /username|email/.test(el.autocomplete || ""));
  if (!user && passwords[0]) {
    // The last text-like field before the password field is almost always the username.
    for (const el of textish) {
      if (el.compareDocumentPosition(passwords[0]) & Node.DOCUMENT_POSITION_FOLLOWING) user = el;
    }
  }
  if (!user && !passwords[0]) user = textish.find((el) => /user|email|login/i.test(el.name + el.id));

  let filled = 0;
  if (user && username) { setValue(user, username); filled++; }
  if (passwords[0] && password) { setValue(passwords[0], password); filled++; }
  return { filled, hasPasswordField: passwords.length > 0 };
}

export function readLoginInPage() {
  const visible = (el) => el.getClientRects().length > 0;
  const pw = [...document.querySelectorAll('input[type="password"]')].find((el) => visible(el) && el.value);
  const scope = pw?.form || document;
  const fields = [...scope.querySelectorAll("input")].filter((el) =>
    visible(el) && ["text", "email", "tel", ""].includes(el.type) && el.value);
  let user = fields.find((el) => /username|email/.test(el.autocomplete || ""));
  if (!user && pw) {
    for (const el of fields) if (el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) user = el;
  }
  return { url: location.origin, title: document.title, username: user?.value || "", password: pw?.value || "" };
}

export function fillProfileInPage(fields) {
  // autocomplete tokens first (the standard way forms declare intent), then name/id/label heuristics.
  const rules = [
    ["givenName", /^(given-name|fname)$/, /first.?name|given|fname|forename/i],
    ["familyName", /^family-name$/, /last.?name|surname|family|lname/i],
    ["email", /^email$/, /e-?mail/i],
    ["phone", /^tel(-national)?$/, /phone|mobile|tel\b|cell/i],
    ["organization", /^organization$/, /company|organi[sz]ation|employer/i],
    ["address1", /^(address-line1|street-address)$/, /address.?(line)?.?1|street|addr1|^address$/i],
    ["address2", /^address-line2$/, /address.?(line)?.?2|apt|suite|unit|addr2/i],
    ["city", /^address-level2$/, /city|town|locality/i],
    ["state", /^address-level1$/, /state|province|region|county/i],
    ["postalCode", /^postal-code$/, /zip|postal|postcode/i],
    ["country", /^country(-name)?$/, /country/i],
  ];
  const visible = (el) => el.getClientRects().length > 0 && !el.disabled && !el.readOnly;
  const labelOf = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
    el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent,
    el.closest("label")?.textContent].filter(Boolean).join(" ");
  const setValue = (el, value) => {
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => [o.value, o.text].some((t) => t.trim().toLowerCase() === value.toLowerCase()));
      if (!opt) return false;
      el.value = opt.value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const used = new Set();
  let filled = 0;
  // Never put profile data into a login form (a form that contains a password field).
  const isLoginForm = (form) => !!form?.querySelector('input[type="password"]');
  const inputs = [...document.querySelectorAll("input, select, textarea")].filter((el) =>
    visible(el) && !isLoginForm(el.form)
    && !["password", "hidden", "submit", "button", "checkbox", "radio", "file"].includes(el.type));
  for (const [key, auto, heuristic] of rules) {
    const value = fields[key];
    if (!value) continue;
    const el = inputs.find((e) => !used.has(e) && auto.test((e.autocomplete || "").replace(/^(shipping|billing) /, "")))
      || inputs.find((e) => !used.has(e) && !e.autocomplete?.match(/\w/) && heuristic.test(labelOf(e)));
    if (el && setValue(el, value)) { used.add(el); filled++; }
  }
  return { filled };
}
