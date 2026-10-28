// Minimal stand-in for the chrome.* APIs Lockbox uses, so the real popup + background code can
// be exercised in a normal page (dev/harness.html). Not shipped with the extension.
(() => {
  const listeners = { message: [], alarm: [], command: [], content: [] };
  const area = () => {
    const data = {};
    return {
      async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
      async remove(key) { delete data[key]; },
      _data: data,
    };
  };
  const siteFrame = () => window.parent.document.getElementById("site");

  window.chrome = {
    runtime: {
      id: "lockbox-dev",
      // Extension pages live under /dev/ in the harness; test sites under /devsites/.
      getURL: (p) => (p ? `${location.origin}/extension/${p}` : `${location.origin}/dev/`),
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      sendMessage: (msg) => new Promise((resolve) => {
        const sender = { id: "lockbox-dev", url: location.href };
        for (const fn of listeners.message) if (fn(msg, sender, resolve) === true) return;
        resolve(undefined);
      }),
    },
    storage: { local: area(), session: area(), onChanged: { addListener() {} } },
    alarms: {
      async create(name, info) { window.__alarms = { ...(window.__alarms || {}), [name]: info }; },
      async clear(name) { if (window.__alarms) delete window.__alarms[name]; },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
      _fire: (name) => listeners.alarm.forEach((fn) => fn({ name })),
    },
    commands: { onCommand: { addListener: (fn) => listeners.command.push(fn) } },
    tabs: {
      async create({ url }) { window.open(url, "_blank"); },
      // Deliver to content-script listeners registered by site frames; first answer wins.
      sendMessage: (_tabId, msg) => new Promise((resolve) => {
        let answered = false;
        for (const fn of listeners.content) {
          if (fn(msg, { id: "lockbox-dev" }, (r) => { if (!answered) { answered = true; resolve(r); } }) === true) continue;
        }
        setTimeout(() => { if (!answered) resolve(undefined); }, 3000);
      }),
      onRemoved: { addListener() {} },
      async query() {
        const f = siteFrame();
        return f ? [{ id: 1, url: f.contentWindow.location.href }] : [];
      },
    },
    scripting: {
      // Re-create the injected function inside the site frame's realm, like Chrome does.
      async executeScript({ func, args = [] }) {
        const win = siteFrame().contentWindow;
        const fn = win.Function(`return (${func.toString()})`)();
        return [{ result: fn(...args) }];
      },
    },
  };
  window.__lockboxDev = { listeners };
})();
