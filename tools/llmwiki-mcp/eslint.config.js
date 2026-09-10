// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      // stdout purity (DESIGN.md §3): the MCP stdio transport owns stdout.
      // Nothing may print via console; use process.stderr.write for diagnostics.
      "no-console": "error",
    },
  },
  {
    // 성능 측정 스크립트(배포물 아님) — Node 전역만 선언하고 stdout 규칙은 적용하지 않는다.
    files: ["test/perf/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", performance: "readonly" } },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  },
);
