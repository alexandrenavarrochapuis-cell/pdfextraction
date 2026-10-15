// Vault encryption, run in the browser (and in tests on Node's WebCrypto).
// The key comes from a passphrase only the owner knows (PBKDF2-SHA256, 600,000
// iterations) and never leaves the device; data is sealed with AES-256-GCM.
// Forgetting the passphrase makes the vault unreadable: there is no recovery.

export const VAULT_CHECK = "trip-command-center-vault-v1";
const ITERATIONS = 600_000;

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

export function newSalt(): string {
  return toB64(randomBytes(16));
}

export async function deriveKey(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<{ iv: string; data: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(12);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: toB64(iv), data: new Uint8Array(sealed) };
}

export async function decryptBytes(key: CryptoKey, ivB64: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, data);
  return new Uint8Array(opened);
}

export async function encryptText(key: CryptoKey, text: string): Promise<{ iv: string; ciphertext: string }> {
  const { iv, data } = await encryptBytes(key, new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>);
  return { iv, ciphertext: toB64(data) };
}

export async function decryptText(key: CryptoKey, ivB64: string, ciphertextB64: string): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(key, ivB64, fromB64(ciphertextB64)));
}

/** True when the passphrase-derived key opens the stored check value. */
export async function keyMatches(key: CryptoKey, checkIv: string, check: string): Promise<boolean> {
  try {
    return (await decryptText(key, checkIv, check)) === VAULT_CHECK;
  } catch {
    return false;
  }
}
