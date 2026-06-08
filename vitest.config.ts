import { defineConfig } from "vitest/config";

// Unit/integration suites use *.test.ts. The Playwright e2e suite uses *.spec.ts
// under apps/workbench/e2e and is run separately (`pnpm --filter @neuralmap/workbench test:e2e`),
// so keep it out of the vitest run.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**", "**/e2e/**"]
  }
});
