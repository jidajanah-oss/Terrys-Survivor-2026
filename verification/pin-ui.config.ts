import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const fixture = fileURLToPath(new URL("./pin-ui-mocks.ts", import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^\.\.\/\.\.\/config\/runtime$/, replacement: fixture },
    { find: /^\.\.\/\.\.\/services\/(authService|accountService|pinAccessService)$/, replacement: fixture },
  ] },
  server: { host: "127.0.0.1", port: 5189, strictPort: true },
});
