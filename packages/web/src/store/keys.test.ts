import { describe, it, expect, beforeEach } from "vitest";
import { initCrypto, resetCrypto, encrypt } from "@/lib/crypto";
import { createKeysStore } from "./keys";
import type { KeysState } from "./keys";
import type { StoreApi } from "zustand";

interface MemStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  data: Record<string, string>;
}

function makeStorage(): MemStorage {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  };
}

describe("keys store", () => {
  let store: StoreApi<KeysState>;
  let storage: MemStorage;

  beforeEach(() => {
    resetCrypto();
    storage = makeStorage();
    initCrypto(storage);
    store = createKeysStore(storage);
  });

  it("should have all providers with status untested and no keys initially", () => {
    const state = store.getState();
    for (const id of ["anthropic", "openai", "google"]) {
      expect(state.providers[id]!.status).toBe("untested");
      expect(state.providers[id]!.encryptedKey).toBeNull();
    }
  });

  it("should store encrypted key via setKey", async () => {
    const encrypted = await encrypt("sk-ant-secret");
    store.getState().setEncryptedKey("anthropic", encrypted);

    const state = store.getState();
    expect(state.providers.anthropic!.encryptedKey).toBe(encrypted);
  });

  it("should update only status via setStatus", () => {
    store.getState().setStatus("openai", "valid");

    const state = store.getState();
    expect(state.providers.openai!.status).toBe("valid");
    expect(state.providers.openai!.encryptedKey).toBeNull();
  });

  it("should set error message via setStatus", () => {
    store.getState().setStatus("google", "invalid", "Bad key");

    const state = store.getState();
    expect(state.providers.google!.status).toBe("invalid");
    expect(state.providers.google!.error).toBe("Bad key");
  });

  it("should clear key and reset status via removeKey", async () => {
    const encrypted = await encrypt("sk-ant-secret");
    store.getState().setEncryptedKey("anthropic", encrypted);
    store.getState().setStatus("anthropic", "valid");
    store.getState().removeKey("anthropic");

    const state = store.getState();
    expect(state.providers.anthropic!.encryptedKey).toBeNull();
    expect(state.providers.anthropic!.status).toBe("untested");
  });

  describe("hasValidKeys", () => {
    it("should return true with 2+ configured providers", async () => {
      const enc1 = await encrypt("key1");
      const enc2 = await encrypt("key2");
      store.getState().setEncryptedKey("anthropic", enc1);
      store.getState().setEncryptedKey("openai", enc2);

      expect(store.getState().hasValidKeys()).toBe(true);
    });

    it("should return false with fewer than 2 configured providers", async () => {
      const enc1 = await encrypt("key1");
      store.getState().setEncryptedKey("anthropic", enc1);

      expect(store.getState().hasValidKeys()).toBe(false);
    });

    it("should return true even when status is not valid (checks config, not status)", async () => {
      const enc1 = await encrypt("key1");
      const enc2 = await encrypt("key2");
      store.getState().setEncryptedKey("anthropic", enc1);
      store.getState().setEncryptedKey("openai", enc2);
      // Status is untested (default after setKey), not "valid"
      // hasValidKeys should still return true since keys are configured

      expect(store.getState().hasValidKeys()).toBe(true);
    });
  });

  it("should return configured provider IDs via getConfiguredProviderIds", async () => {
    const enc1 = await encrypt("key1");
    const enc2 = await encrypt("key2");
    store.getState().setEncryptedKey("anthropic", enc1);
    store.getState().setEncryptedKey("google", enc2);

    const ids = store.getState().getConfiguredProviderIds();
    expect(ids).toContain("anthropic");
    expect(ids).toContain("google");
    expect(ids).not.toContain("openai");
  });

  it("should decrypt all configured keys via getKeys", async () => {
    store.getState().setEncryptedKey("anthropic", await encrypt("sk-ant-secret"));
    store.getState().setEncryptedKey("openai", await encrypt("sk-oai-secret"));

    const keys = await store.getState().getKeys();
    expect(keys).toEqual({
      anthropic: "sk-ant-secret",
      openai: "sk-oai-secret",
    });
  });

  it("should persist state across store re-creation", async () => {
    const enc = await encrypt("sk-persist-test");
    store.getState().setEncryptedKey("anthropic", enc);
    store.getState().setStatus("anthropic", "valid");

    // Create a new store with the same backing storage — simulates page reload
    const store2 = createKeysStore(storage);

    // Zustand persist rehydrates synchronously from the storage adapter
    const state = store2.getState();
    expect(state.providers.anthropic!.encryptedKey).toBe(enc);
    expect(state.providers.anthropic!.status).toBe("valid");
  });
});
