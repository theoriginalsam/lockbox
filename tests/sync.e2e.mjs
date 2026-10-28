// End-to-end sync test against a running API (the samir-portfolio dev server with
// LOCKBOX_STORE=memory). Skipped unless LOCKBOX_API is set:
//   LOCKBOX_API=http://localhost:3100/api/lockbox node --test tests/sync.e2e.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { decryptJSON, deriveKeys, newKdfParams, sealVault } from "../extension/src/crypto.js";
import * as sync from "../extension/src/sync.js";
import { emptyVault, liveItems, mergeVaults, upsertItem } from "../extension/src/vault.js";

const API = process.env.LOCKBOX_API;
const fx = JSON.parse(readFileSync(new URL("../dev/test-fixtures.json", import.meta.url)));

test("two devices sync through the API without the server ever seeing plaintext", { skip: !API }, async () => {
  // Device A: create a vault and enroll it.
  const kdf = newKdfParams();
  const a = await deriveKeys(fx.masterPassword, kdf);
  let vaultA = upsertItem(emptyVault(), { type: "login", ...fx.login, name: "Test site" }).vault;
  assert.equal(await sync.fetchParams(API), null, "fresh server has no vault");
  await assert.rejects(
    sync.enroll(API, { enrollToken: "wrong-code-wrong-code", authToken: a.authToken, sealed: await sealVault(vaultA, a.encKey, kdf) }),
    /Invalid enrollment code/);
  const v1 = await sync.enroll(API, { enrollToken: fx.enrollToken, authToken: a.authToken, sealed: await sealVault(vaultA, a.encKey, kdf) });
  assert.equal(v1, 1);
  await assert.rejects(
    sync.enroll(API, { enrollToken: fx.enrollToken, authToken: a.authToken, sealed: await sealVault(vaultA, a.encKey, kdf) }),
    /already enrolled/, "a second enrollment must be refused");

  // What the server holds is ciphertext only.
  const raw = await (await fetch(API, { headers: { Authorization: `Bearer ${a.authToken}` } })).text();
  assert.ok(!raw.includes(fx.login.password) && !raw.includes(fx.login.username));

  // Device B: knows only the password. Fetch params -> derive -> pull -> decrypt.
  const kdfB = await sync.fetchParams(API);
  const b = await deriveKeys(fx.masterPassword, kdfB);
  assert.equal(b.authToken, a.authToken);
  let pulled = await sync.pull(API, b.authToken);
  let vaultB = await decryptJSON(pulled.sealed.box, b.encKey);
  assert.equal(liveItems(vaultB)[0].password, fx.login.password);

  // Both devices edit offline; A pushes first, B gets a conflict, merges, pushes.
  vaultA = upsertItem(vaultA, { type: "note", name: "From A", text: "a" }).vault;
  const resA = await sync.push(API, a.authToken, await sealVault(vaultA, a.encKey, kdf), 1);
  assert.deepEqual(resA, { ok: true, version: 2 });

  vaultB = upsertItem(vaultB, { type: "note", name: "From B", text: "b" }).vault;
  const conflict = await sync.push(API, b.authToken, await sealVault(vaultB, b.encKey, kdfB), 1);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.version, 2);
  const merged = mergeVaults(vaultB, await decryptJSON(conflict.sealed.box, b.encKey));
  const resB = await sync.push(API, b.authToken, await sealVault(merged, b.encKey, kdfB), conflict.version);
  assert.deepEqual(resB, { ok: true, version: 3 });

  pulled = await sync.pull(API, a.authToken);
  const final = await decryptJSON(pulled.sealed.box, a.encKey);
  assert.deepEqual(liveItems(final).map((i) => i.name).sort(), ["From A", "From B", "Test site"]);

  // Uploading a vault encrypted under a different salt (i.e. a different password) is refused.
  const other = newKdfParams();
  const otherKeys = await deriveKeys("some other password entirely", other);
  await assert.rejects(sync.push(API, a.authToken, await sealVault(final, otherKeys.encKey, other), 3), /Invalid vault payload/);
});

test("bad tokens are rejected, then rate-limited; web-page origins are refused", { skip: !API }, async () => {
  const fake = "0".repeat(64);
  for (let i = 0; i < 5; i++) {
    await assert.rejects(sync.pull(API, fake), /rejected/);
  }
  await assert.rejects(sync.pull(API, fake), /rejected|Too many/);
  const limited = await fetch(API, { headers: { Authorization: `Bearer ${fake}` } });
  assert.equal(limited.status, 429, "after repeated failures the vault endpoint backs off");

  const fromWebPage = await fetch(`${API}/params`, { headers: { Origin: "https://evil.example" } });
  assert.equal(fromWebPage.status, 403);
});
