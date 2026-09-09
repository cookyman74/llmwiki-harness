import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8"));

describe("package scaffold", () => {
  it("has the expected name and version", () => {
    expect(pkg.name).toBe("llmwiki-mcp");
    expect(pkg.version).toBe("0.1.0");
  });
  it("is an ESM package exposing the llmwiki-mcp bin", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.bin["llmwiki-mcp"]).toBe("dist/cli.js");
  });
  it("ships only runtime deps @modelcontextprotocol/sdk and zod", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@modelcontextprotocol/sdk", "zod"]);
  });
});
