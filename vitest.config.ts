import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.worker.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.toml" },
            // INBOX_TOKEN is a secret in production (wrangler secret); tests
            // bind a deterministic value instead of committing one.
            miniflare: {
              bindings: {
                INBOX_TOKEN: "test-inbox-token",
                // x402 gate ships disabled; gated tests flip it on in-test
                // with the same env-override pattern as the AI mock.
                X402_ENABLED: "false",
              },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["tests/**/*.worker.test.ts"],
          setupFiles: ["tests/setup.workers.ts"],
        },
      },
    ],
  },
});
