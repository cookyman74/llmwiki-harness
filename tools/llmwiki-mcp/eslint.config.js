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
    ignores: ["dist/**", "node_modules/**"],
  },
);
