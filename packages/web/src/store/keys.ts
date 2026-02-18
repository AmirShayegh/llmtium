import { createStore } from "zustand/vanilla";
import { persist, createJSONStorage } from "zustand/middleware";
import { decrypt, ensureCryptoReady } from "@/lib/crypto";

export type KeyStatus = "untested" | "validating" | "valid" | "invalid";

export interface ProviderKeyState {
  encryptedKey: string | null;
  status: KeyStatus;
  error?: string;
}

export interface KeysState {
  providers: Record<string, ProviderKeyState>;
  setEncryptedKey: (providerId: string, encryptedKey: string) => void;
  setStatus: (providerId: string, status: KeyStatus, error?: string) => void;
  removeKey: (providerId: string) => void;
  getKeys: () => Promise<Record<string, string>>;
  hasValidKeys: () => boolean;
  getConfiguredProviderIds: () => string[];
}

const PROVIDER_IDS = ["anthropic", "openai", "google"] as const;

function makeInitialProviders(): Record<string, ProviderKeyState> {
  const providers: Record<string, ProviderKeyState> = {};
  for (const id of PROVIDER_IDS) {
    providers[id] = { encryptedKey: null, status: "untested" };
  }
  return providers;
}

interface PersistStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createKeysStore(storage?: PersistStorage) {
  return createStore<KeysState>()(
    persist(
      (set, get) => ({
        providers: makeInitialProviders(),

        setEncryptedKey: (providerId, encryptedKey) =>
          set((state) => ({
            providers: {
              ...state.providers,
              [providerId]: {
                ...state.providers[providerId],
                encryptedKey,
              },
            },
          })),

        setStatus: (providerId, status, error?) =>
          set((state) => ({
            providers: {
              ...state.providers,
              [providerId]: {
                ...state.providers[providerId],
                status,
                error,
              },
            },
          })),

        removeKey: (providerId) =>
          set((state) => ({
            providers: {
              ...state.providers,
              [providerId]: { encryptedKey: null, status: "untested" },
            },
          })),

        getKeys: async () => {
          ensureCryptoReady();
          const providers = get().providers;
          const result: Record<string, string> = {};
          for (const [id, state] of Object.entries(providers)) {
            if (state.encryptedKey) {
              result[id] = await decrypt(state.encryptedKey);
            }
          }
          return result;
        },

        hasValidKeys: () => {
          const providers = get().providers;
          const configured = Object.values(providers).filter(
            (p) => p.encryptedKey !== null,
          );
          return configured.length >= 2;
        },

        getConfiguredProviderIds: () => {
          const providers = get().providers;
          return Object.entries(providers)
            .filter(([, p]) => p.encryptedKey !== null)
            .map(([id]) => id);
        },
      }),
      {
        name: "llmtium-keys",
        storage: createJSONStorage(() =>
          storage ?? (typeof window !== "undefined" ? localStorage : {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          }),
        ),
        partialize: (state) => ({ providers: state.providers }),
      },
    ),
  );
}
