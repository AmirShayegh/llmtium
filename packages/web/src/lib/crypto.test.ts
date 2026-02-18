import { describe, it, expect, beforeEach } from "vitest";
import { initCrypto, resetCrypto, getOrCreateKey, encrypt, decrypt } from "./crypto";

interface MemStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  data: Record<string, string>;
}

function makeStorage(): MemStorage {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

describe("crypto", () => {
  beforeEach(() => {
    resetCrypto();
  });

  describe("encrypt / decrypt", () => {
    it("should return a non-empty string different from plaintext", async () => {
      const storage = makeStorage();
      initCrypto(storage);
      const plaintext = "sk-ant-my-secret-key";
      const ciphertext = await encrypt(plaintext);

      expect(ciphertext.length).toBeGreaterThan(0);
      expect(ciphertext).not.toBe(plaintext);
    });

    it("should round-trip correctly", async () => {
      const storage = makeStorage();
      initCrypto(storage);
      const plaintext = "sk-ant-my-secret-key-12345";
      const ciphertext = await encrypt(plaintext);
      const decrypted = await decrypt(ciphertext);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext each call (random IV)", async () => {
      const storage = makeStorage();
      initCrypto(storage);
      const plaintext = "same-key-value";
      const ct1 = await encrypt(plaintext);
      const ct2 = await encrypt(plaintext);

      expect(ct1).not.toBe(ct2);
    });

    it("should fail to decrypt tampered ciphertext", async () => {
      const storage = makeStorage();
      initCrypto(storage);
      const ciphertext = await encrypt("my-secret");

      // Flip a character in the middle of the base64 string
      const chars = ciphertext.split("");
      const mid = Math.floor(chars.length / 2);
      chars[mid] = chars[mid] === "A" ? "B" : "A";
      const tampered = chars.join("");

      await expect(decrypt(tampered)).rejects.toThrow();
    });

    it("should fail to decrypt garbage input", async () => {
      const storage = makeStorage();
      initCrypto(storage);

      await expect(decrypt("not-valid-base64!!!")).rejects.toThrow();
    });
  });

  describe("getOrCreateKey", () => {
    it("should return a CryptoKey", async () => {
      const storage = makeStorage();
      initCrypto(storage);
      const key = await getOrCreateKey();

      expect(key).toBeDefined();
      expect(key.type).toBe("secret");
      expect(key.algorithm).toMatchObject({ name: "AES-GCM" });
    });

    it("should return the same key on subsequent calls (reads salt from storage)", async () => {
      const storage = makeStorage();
      initCrypto(storage);

      const key1 = await getOrCreateKey();
      const key2 = await getOrCreateKey();

      // Export both keys to compare raw bytes
      const raw1 = await crypto.subtle.exportKey("raw", key1);
      const raw2 = await crypto.subtle.exportKey("raw", key2);

      expect(new Uint8Array(raw1)).toEqual(new Uint8Array(raw2));
    });

    it("should produce different keys with different salts (cross-salt isolation)", async () => {
      // Encrypt with salt A
      const storageA = makeStorage();
      initCrypto(storageA);
      const ciphertext = await encrypt("secret-value");

      // Re-init with different storage (different salt)
      resetCrypto();
      const storageB = makeStorage();
      initCrypto(storageB);

      // Decryption should fail because the derived key is different
      await expect(decrypt(ciphertext)).rejects.toThrow();
    });
  });

  describe("fail-fast guards", () => {
    it("should throw if encrypt is called before initCrypto", async () => {
      // resetCrypto was called in beforeEach, so module is uninitialized
      await expect(encrypt("test")).rejects.toThrow(/not initialized/);
    });

    it("should throw if decrypt is called before initCrypto", async () => {
      await expect(decrypt("test")).rejects.toThrow(/not initialized/);
    });
  });

  describe("ensureCryptoReady", () => {
    it("should auto-initialize and work without explicit initCrypto when storage is provided", async () => {
      const storage = makeStorage();
      // Use ensureCryptoReady instead of initCrypto — this is the safe entry point
      const { ensureCryptoReady } = await import("./crypto");
      ensureCryptoReady(storage);
      const plaintext = "auto-init-test";
      const ct = await encrypt(plaintext);
      const pt = await decrypt(ct);
      expect(pt).toBe(plaintext);
    });
  });
});
