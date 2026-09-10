/**
 * 패키지 이름 단일 소스 — print-config 가 내는 `npx -y <이름>` 과 package.json `name`·`bin` 이 어긋나지 않게 고정한다.
 * 원안 `llmwiki-mcp` 가 npm 유사도 정책으로 거부되어 `obsidian-llmwiki-mcp` 로 바꾸면서(2026-09-11) 생긴 불변식:
 * 패키지 이름과 실행 명령(bin)은 다르고, bin 은 하나뿐이어야 `npx -y <패키지>` 가 그 명령을 실행한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BIN_NAME, PKG_NAME, printConfig } from "../../src/print-config.js";

const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")) as {
  name: string;
  bin: Record<string, string>;
};

describe("패키지 이름 단일 소스", () => {
  it("PKG_NAME = package.json name, BIN_NAME = 유일한 bin", () => {
    expect(PKG_NAME).toBe(pkg.name);
    expect(Object.keys(pkg.bin)).toEqual([BIN_NAME]); // bin 이 둘 이상이면 npx 가 어느 것을 실행할지 모호해진다
  });
  it("print-config 는 npx 형에 패키지 이름, --global 형에 실행 명령을 쓴다", () => {
    expect(printConfig({ client: "claude-code", root: "/v" })).toContain(`npx -y ${PKG_NAME} --root /v`);
    const g = printConfig({ client: "claude-code", root: "/v", global: true });
    expect(g).toContain(`-- ${BIN_NAME} --root /v`);
    expect(g).not.toContain("npx");
  });
});
