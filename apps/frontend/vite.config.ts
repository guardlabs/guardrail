import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __DEFAULT_BACKEND_URL__: JSON.stringify(
      process.env.AGENT_WALLET_DEFAULT_BACKEND_URL ?? null,
    ),
  },
});
