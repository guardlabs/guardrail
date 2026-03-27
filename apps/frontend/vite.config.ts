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
        env.AGENT_WALLET_DEFAULT_BACKEND_URL ?? null,
      ),
      __PASSKEY_SERVER_URL__: JSON.stringify(
        env.AGENT_WALLET_PASSKEY_SERVER_URL ?? null,
      ),
      __BASE_SEPOLIA_RPC_URL__: JSON.stringify(
        env.AGENT_WALLET_PUBLIC_RPC_URL_84532 ?? null,
      ),
      __BASE_SEPOLIA_BUNDLER_URL__: JSON.stringify(
        env.AGENT_WALLET_BUNDLER_URL_84532 ?? null,
      ),
    },
  };
});
