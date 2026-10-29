// Loaded by the fake test sites (devsites/*.html) BEFORE content.js: gives the content script a
// chrome.* that talks to the real background code running in the harness's popup frame.
(() => {
  window.__LOCKBOX_TEST__ = true;   // lets the harness inspect the helper's shadow root (dev only)
  const popupWin = () => window.parent.document.getElementById("popup").contentWindow;
  window.chrome = {
    runtime: {
      id: "lockbox-dev",
      sendMessage: (msg) => new Promise((resolve) => {
        const sender = { id: "lockbox-dev", tab: { id: 1, url: location.href }, url: location.href, frameId: 0 };
        for (const fn of popupWin().__lockboxDev.listeners.message) if (fn(msg, sender, resolve) === true) return;
        resolve(undefined);
      }),
      onMessage: { addListener: (fn) => popupWin().__lockboxDev.listeners.content.push(fn) },
    },
    storage: { onChanged: { addListener() {} } },
  };
})();
