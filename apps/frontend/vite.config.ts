import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(configDirectory, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");

  return {
    envDir: repoRoot,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (
              id.includes("@zerodev/") ||
              id.includes("@simplewebauthn/") ||
              id.includes("cborg") ||
              id.includes("cbor2")
            ) {
              return "passkey-vendor";
            }

            if (id.includes("@noble/") || id.includes("@scure/")) {
              return "crypto-vendor";
            }

            if (id.includes("abitype") || id.includes("/ox/")) {
              return "evm-vendor";
            }

            if (id.includes("viem")) {
              return "viem-vendor";
            }

            return undefined;
          },
        },
      },
    },
    plugins: [
      react(),
      nodePolyfills({
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
        protocolImports: true,
      }),
    ],
    define: {
      __DEFAULT_BACKEND_URL__: JSON.stringify(
        env.CONDUIT_PUBLIC_BACKEND_URL ?? null,
      ),
      __PASSKEY_SERVER_URL__: JSON.stringify(
        env.CONDUIT_PASSKEY_SERVER_URL ?? null,
      ),
      __BASE_SEPOLIA_RPC_URL__: JSON.stringify(
        env.CONDUIT_PUBLIC_RPC_URL_84532 ?? null,
      ),
      __BASE_SEPOLIA_BUNDLER_URL__: JSON.stringify(
        env.CONDUIT_BUNDLER_URL_84532 ?? null,
      ),
      __BASE_RPC_URL__: JSON.stringify(env.CONDUIT_PUBLIC_RPC_URL_8453 ?? null),
      __BASE_BUNDLER_URL__: JSON.stringify(
        env.CONDUIT_BUNDLER_URL_8453 ?? null,
      ),
      __BASE_SEPOLIA_OUTGOING_BUDGET_POLICY_ADDRESS__: JSON.stringify(
        env.CONDUIT_OUTGOING_BUDGET_POLICY_ADDRESS_84532 ?? null,
      ),
      __BASE_OUTGOING_BUDGET_POLICY_ADDRESS__: JSON.stringify(
        env.CONDUIT_OUTGOING_BUDGET_POLICY_ADDRESS_8453 ?? null,
      ),
    },
  };
});
