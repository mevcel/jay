// SPDX-License-Identifier: MIT
// Pons Family: test runner configuration for Jay, the pons.family support agent.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { LOG_LEVEL: "silent" },
  },
});
