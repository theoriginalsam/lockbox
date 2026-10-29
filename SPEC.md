# Lockbox vault & sync format (v1)

The contract every Lockbox client implements: the Chrome extension today, the iPhone app
next. Standard primitives only, all available in WebCrypto and in Apple CryptoKit /
CommonCrypto.

## 1. Keys

```
salt         16 random bytes, base64            (stored in kdf.salt, public)
master       = PBKDF2-HMAC-SHA256(NFKC(password), salt, iterations, 32 bytes)
enc_key      = HKDF-SHA256(ikm=master, salt=32 zero bytes, info="lockbox/v1/encryption",  L=32)
auth_token   = HKDF-SHA256(ikm=master, salt=32 zero bytes, info="lockbox/v1/server-auth", L=32) → lowercase hex
```

- `iterations` ≥ 310,000 (default 600,000). Clients must refuse weaker parameters.
- iOS: `CCKeyDerivationPBKDF` (CommonCrypto) for PBKDF2; `HKDF<SHA256>.deriveKey` and
  `AES.GCM` from CryptoKit.

## 2. Sealed vault (what is stored locally and on the server)

```json
{
  "format": "lockbox", "v": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<b64>" },
  "box": { "iv": "<b64, 12 bytes>", "ct": "<b64: AES-256-GCM ciphertext || 16-byte tag>" }
}
```

- AES-256-GCM with `enc_key`, a fresh random 12-byte IV per write, additional authenticated
  data = UTF-8 `"lockbox/v1"`.
- WebCrypto appends the tag to the ciphertext; CryptoKit's `AES.GCM.SealedBox(combined:)`
  expects `nonce || ciphertext || tag`, so prepend the IV when opening on iOS.
- Plaintext = UTF-8 JSON of the vault (§3).

## 3. Vault plaintext

```json
{ "schema": 1, "updatedAt": 1793228529628, "items": [ ITEM, ... ] }
```

Every item has `id` (UUID), `type`, `name`, `updatedAt` (ms since epoch). Deleted items stay as
tombstones `{ id, type, deleted: true, updatedAt }`.

| type | fields |
|---|---|
| `login` | `url` (origin, e.g. `https://github.com`), `username`, `password`, `notes` |
| `note` | `text` |
| `profile` | `fields`: givenName, familyName, email, phone, dateOfBirth (YYYY-MM-DD), organization, address1, address2, city, state, postalCode, country; `notes` (free text) |
| `quick` | `password`: a reused password offered on new sites |
| `job` | `profile`: Nightshift `profile.yaml` schema (contact, headline, summary, experience[], projects[], education[], skills[], certifications[], answers{…, custom{}}) |

Clients must preserve unknown fields and item types they don't understand (forward
compatibility).

## 4. Merge

Item-level last-writer-wins: for each `id` keep the copy with the larger `updatedAt`; on a tie,
the copy whose JSON serialisation sorts higher. Tombstones participate like any item.
`mergeVaults(a, b) == mergeVaults(b, a)`.

## 5. Sync API (`https://www.samirpoudel.com.np/api/lockbox`)

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| GET | `/params` | none | → `{ kdf }` (404 if nothing enrolled) |
| POST | `/enroll` | enrollment code | `{ enrollToken, authToken, kdf, blob }` → 201 `{ version: 1 }` |
| GET | `` | `Bearer <auth_token>` | → `{ blob, version }` |
| PUT | `` | `Bearer <auth_token>` | `{ blob, version: <expected> }` → `{ version }` or 409 `{ blob, version }` |

Push is compare-and-swap. On 409: decrypt the returned blob, merge (§4), re-seal, retry with the
returned version. The server stores `sha256(auth_token)` only and backs off after 5 bad tokens.

## 6. Matching rules for autofill (all clients)

- Offer a login only on an exact host match (leading `www.` ignored), same port. No subdomain
  matching. Never fill an `https` login into an `http` page (localhost excepted).
- Quick passwords are offered only on password fields, one at a time, on explicit user action,
  with the destination host shown.
- iOS: implement as a Credential Provider extension (`ASCredentialProviderViewController`)
  reading the same sealed vault (shared App Group container), using the same matching rules
  against `ASCredentialServiceIdentifier`.

## Not synced yet

The resume file (encrypted per device under `lockboxFiles`) is not part of the vault blob.
A future v2 will sync attachments as separately encrypted objects.
