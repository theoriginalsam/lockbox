// Client for the sync API on samirpoudel.com.np. The server only ever sees the sealed vault
// (ciphertext + KDF params) and a token derived from the master password.

export const DEFAULT_API = "https://www.samirpoudel.com.np/api/vault";

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(base, path, { method = "GET", token, body } = {}) {
  const url = `${base.replace(/\/+$/, "")}${path}`;
  if (!/^https:\/\//.test(url) && !/^http:\/\/localhost(:\d+)?\//.test(url)) {
    throw new SyncError("Sync server must use https");
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new SyncError("Can't reach the sync server");
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** KDF params (salt etc.) are public: a new device needs them to derive keys from the password. */
export async function fetchParams(base) {
  const { status, data } = await call(base, "/params");
  if (status === 404) return null;
  if (status !== 200) throw new SyncError(data.error || `Server error ${status}`, status);
  return data.kdf;
}

export async function enroll(base, { enrollToken, authToken, sealed }) {
  const { status, data } = await call(base, "/enroll", {
    method: "POST", body: { enrollToken, authToken, kdf: sealed.kdf, blob: sealed },
  });
  if (status !== 201) throw new SyncError(data.error || `Enrollment failed (${status})`, status);
  return data.version;
}

export async function pull(base, authToken) {
  const { status, data } = await call(base, "", { token: authToken });
  if (status === 401) throw new SyncError("Server rejected the vault credentials", 401);
  if (status !== 200) throw new SyncError(data.error || `Server error ${status}`, status);
  return { sealed: data.blob, version: data.version };
}

/** Returns {ok, version} or {conflict, sealed, version} when someone else pushed first. */
export async function push(base, authToken, sealed, expectedVersion) {
  const { status, data } = await call(base, "", {
    method: "PUT", token: authToken, body: { blob: sealed, version: expectedVersion },
  });
  if (status === 200) return { ok: true, version: data.version };
  if (status === 409) return { conflict: true, sealed: data.blob, version: data.version };
  if (status === 401) throw new SyncError("Server rejected the vault credentials", 401);
  throw new SyncError(data.error || `Server error ${status}`, status);
}
