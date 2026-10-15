import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [{
    name: "astro-transitions-test-module",
    // Astro provides this virtual module during app builds. Let DOM tests
    // resolve it so vi.mock can supply navigation without running Astro.
    resolveId(id) { if (id === "astro:transitions/client") return id },
  }],
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
