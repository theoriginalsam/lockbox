// Lockbox cryptography. WebCrypto primitives only, no homemade crypto.
//
//   master password --PBKDF2-SHA256 (600k iterations, random 16-byte salt)--> master key
//   master key --HKDF "lockbox/v1/encryption"--> AES-256-GCM key   (never leaves this device)
//   master key --HKDF "lockbox/v1/server-auth"--> 256-bit auth token (proves identity to the
//                                                  sync server, which stores only its SHA-256)
//
// Knowing the auth token does not help decrypt: HKDF outputs with different labels are independent.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AAD = encoder.encode("lockbox/v1");

export const KDF_DEFAULTS = Object.freeze({ name: "PBKDF2", hash: "SHA-256", iterations: 600_000 });
export const MIN_ITERATIONS = 310_000;

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newKdfParams() {
  return { ...KDF_DEFAULTS, salt: toB64(randomBytes(16)) };
}

/** Derive the encryption key and the server auth token from the master password. */
export async function deriveKeys(password, kdf) {
  if (!password) throw new Error("Master password is required");
  if (kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || kdf.iterations < MIN_ITERATIONS) {
    throw new Error("Unsupported or too-weak key derivation parameters");
  }
  const base = await crypto.subtle.importKey(
    "raw", encoder.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(kdf.salt), iterations: kdf.iterations }, base, 256);
  const hkdf = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey", "deriveBits"]);
  const label = (info) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode(info) });
  const encKey = await crypto.subtle.deriveKey(
    label("lockbox/v1/encryption"), hkdf, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const authToken = toHex(await crypto.subtle.deriveBits(label("lockbox/v1/server-auth"), hkdf, 256));
  return { encKey, authToken };
}

export async function exportKey(key) {
  return toB64(await crypto.subtle.exportKey("raw", key));
}

export async function importKey(b64) {
  return crypto.subtle.importKey("raw", fromB64(b64), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

/** Encrypt any JSON value. A fresh random IV every time; AES-GCM also authenticates. */
export async function encryptJSON(value, key) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD }, key, encoder.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** Throws if the key is wrong or a single bit of the ciphertext was changed. */
export async function decryptJSON(box, key) {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(box.iv), additionalData: AAD }, key, fromB64(box.ct));
    return JSON.parse(decoder.decode(pt));
  } catch {
    throw new Error("Wrong master password or corrupted vault");
  }
}

/** Sealed vault = everything needed to unlock it later except the password. */
export async function sealVault(vault, key, kdf) {
  return { format: "lockbox", v: 1, kdf, box: await encryptJSON(vault, key) };
}

export async function openVault(sealed, password) {
  if (sealed?.format !== "lockbox" || sealed.v !== 1) throw new Error("Not a Lockbox vault");
  const keys = await deriveKeys(password, sealed.kdf);
  const vault = await decryptJSON(sealed.box, keys.encKey);
  return { vault, ...keys };
}

/** Rough strength estimate for the setup screen (bits of entropy, character-class based). */
export function passwordStrength(pw) {
  if (!pw) return { bits: 0, label: "empty" };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const bits = Math.round(pw.length * Math.log2(Math.max(pool, 1)));
  const label = bits >= 80 ? "strong" : bits >= 60 ? "good" : bits >= 40 ? "weak" : "too weak";
  return { bits, label };
}
