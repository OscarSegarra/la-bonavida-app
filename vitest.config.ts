import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      // fileURLToPath rather than .pathname: on Windows the latter yields
      // "/C:/Users/..." with a leading slash, which does not resolve. The
      // alias had been wrong since it was written and nothing noticed,
      // because no tested module imported through "@/" until the recipes
      // module did - and CI runs on Linux, where both spellings work.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
