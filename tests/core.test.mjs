// Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptJSON, deriveKeys, encryptJSON, exportKey, importKey, newKdfParams, openVault,
  passwordStrength, sealVault,
} from "../extension/src/crypto.js";
import {
  deleteItem, emptyVault, liveItems, matchesSite, mergeVaults, normalizeUrl, searchItems, upsertItem,
} from "../extension/src/vault.js";

const FAST = { name: "PBKDF2", hash: "SHA-256", iterations: 310_000 };   // minimum allowed, keeps tests quick

test("vault round-trips through seal/open with the right password only", async () => {
  const kdf = { ...FAST, salt: newKdfParams().salt };
  const { encKey } = await deriveKeys("correct horse battery staple", kdf);
  const { vault } = upsertItem(emptyVault(), { type: "login", url: "github.com", username: "sam", password: "s3cret" });
  const sealed = await sealVault(vault, encKey, kdf);

  assert.ok(!JSON.stringify(sealed).includes("s3cret"), "plaintext must not appear in the sealed vault");
  const opened = await openVault(sealed, "correct horse battery staple");
  assert.equal(liveItems(opened.vault)[0].password, "s3cret");
  await assert.rejects(openVault(sealed, "wrong password"), /Wrong master password/);
});

test("tampering with one byte of ciphertext is detected", async () => {
  const { encKey } = await deriveKeys("pw-for-tamper-test", { ...FAST, salt: newKdfParams().salt });
  const box = await encryptJSON({ a: 1 }, encKey);
  const bytes = Uint8Array.from(atob(box.ct), (c) => c.charCodeAt(0));
  bytes[0] ^= 1;
  const tampered = { ...box, ct: btoa(String.fromCharCode(...bytes)) };
  await assert.rejects(decryptJSON(tampered, encKey), /corrupted/);
});

test("same password + salt gives the same keys; auth token is not the encryption key", async () => {
  const kdf = { ...FAST, salt: newKdfParams().salt };
  const a = await deriveKeys("pw", kdf);
  const b = await deriveKeys("pw", kdf);
  assert.equal(a.authToken, b.authToken);
  assert.equal(await exportKey(a.encKey), await exportKey(b.encKey));
  assert.notEqual(a.authToken, Buffer.from(await exportKey(a.encKey), "base64").toString("hex"));
  const other = await deriveKeys("pw", { ...FAST, salt: newKdfParams().salt });
  assert.notEqual(other.authToken, a.authToken, "a different salt must give different keys");
});

test("exported session key re-imports and still decrypts", async () => {
  const { encKey } = await deriveKeys("pw", { ...FAST, salt: newKdfParams().salt });
  const box = await encryptJSON({ hello: "world" }, encKey);
  const restored = await importKey(await exportKey(encKey));
  assert.deepEqual(await decryptJSON(box, restored), { hello: "world" });
});

test("weak KDF parameters are refused", async () => {
  await assert.rejects(deriveKeys("pw", { ...FAST, iterations: 1000, salt: "AAAA" }), /too-weak/);
});

test("site matching blocks look-alikes, subdomains and https->http downgrade", () => {
  const item = { type: "login", url: normalizeUrl("https://www.github.com/login") };
  assert.equal(item.url, "https://www.github.com");
  assert.ok(matchesSite(item, "https://github.com/session"));
  assert.ok(matchesSite(item, "https://www.github.com/"));
  assert.ok(!matchesSite(item, "https://github.com.evil.io/"));
  assert.ok(!matchesSite(item, "https://gist.github.com/"));
  assert.ok(!matchesSite(item, "http://github.com/"));
  assert.ok(!matchesSite(item, "file:///etc/passwd"));
  assert.ok(matchesSite({ type: "login", url: "http://localhost:8099" }, "http://localhost:8099/form"));
  assert.ok(!matchesSite({ type: "login", url: "http://localhost:8099" }, "http://localhost:3000/"));
});

test("merge keeps the newest version of each item and lets deletes win when newer", () => {
  let a = emptyVault();
  ({ vault: a } = upsertItem(a, { id: "x", type: "note", name: "n", text: "v1" }, 100));
  ({ vault: a } = upsertItem(a, { id: "y", type: "note", name: "keep", text: "y" }, 100));
  let b = structuredClone(a);
  ({ vault: a } = upsertItem(a, { id: "x", type: "note", name: "n", text: "v2 from laptop" }, 200));
  b = deleteItem(b, "y", 300);
  ({ vault: b } = upsertItem(b, { id: "z", type: "note", name: "new", text: "z" }, 250));

  const m1 = mergeVaults(a, b);
  const m2 = mergeVaults(b, a);
  assert.deepEqual(m1, m2, "merge must be order-independent");
  const live = Object.fromEntries(liveItems(m1).map((i) => [i.id, i]));
  assert.equal(live.x.text, "v2 from laptop");
  assert.equal(live.z.text, "z");
  assert.ok(!live.y, "a newer delete removes the item everywhere");
});

test("items are sanitised and searchable", () => {
  const { vault } = upsertItem(emptyVault(), { type: "profile", name: "Home", fields: { email: " me@x.com ", bogus: "?" } });
  const [p] = liveItems(vault);
  assert.equal(p.fields.email, "me@x.com");
  assert.ok(!("bogus" in p.fields));
  assert.equal(searchItems(vault, "ME@X").length, 1);
  assert.throws(() => upsertItem(vault, { type: "crypto-wallet" }), /Unknown item type/);
});

test("password strength labels", () => {
  assert.equal(passwordStrength("abc").label, "too weak");
  assert.equal(passwordStrength("Tr0ub4dor&3-and-more-words").label, "strong");
});
