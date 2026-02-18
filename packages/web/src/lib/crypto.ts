export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SALT_STORAGE_KEY = "llmtium-salt";
const APP_IDENTIFIER = "llmtium-key-v1";
const PBKDF2_ITERATIONS = 100_000;

let _storage: KeyStorage | null = null;
let _keyCache: CryptoKey | null = null;

export function initCrypto(storage: KeyStorage): void {
  _storage = storage;
  _keyCache = null;
}

export function resetCrypto(): void {
  _storage = null;
  _keyCache = null;
}

export function ensureCryptoReady(storage?: KeyStorage): void {
  if (_storage) return;
  if (storage) {
    initCrypto(storage);
    return;
  }
  if (typeof window !== "undefined") {
    initCrypto(localStorage);
    return;
  }
  throw new Error("crypto not initialized — call initCrypto() first");
}

function ensureInitialized(): KeyStorage {
  if (!_storage) {
    throw new Error("crypto not initialized — call initCrypto() first");
  }
  return _storage;
}

export async function getOrCreateKey(): Promise<CryptoKey> {
  const storage = ensureInitialized();

  if (_keyCache) return _keyCache;

  let saltB64 = storage.getItem(SALT_STORAGE_KEY);
  if (!saltB64) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltB64 = btoa(String.fromCharCode(...salt));
    storage.setItem(SALT_STORAGE_KEY, saltB64);
  }

  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_IDENTIFIER),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const derived = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  _keyCache = derived;
  return derived;
}

export async function encrypt(plaintext: string): Promise<string> {
  ensureInitialized();
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertext: string): Promise<string> {
  ensureInitialized();
  const key = await getOrCreateKey();

  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}
