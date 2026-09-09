/**
 * P3-02~P3-04 — 클라이언트 규칙 스니펫의 정본/파생 정합성 (DESIGN §8).
 *   정본: templates/mcp-client-guide.md (≤20 content lines, 라우팅 표 + 규약 3줄)
 *   파생: templates/clients/{claude-skill/SKILL.md, codex-AGENTS.md, gemini-GEMINI.md, cursor-llmwiki.mdc}
 * 파생은 build.py 가 정본에서 생성하므로, 손편집(=stale) 검출은 `build.py --check` 에 위임한다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/tools.js";
import { PKG_DIR } from "./p2-helpers.js";

const REPO_ROOT = path.join(PKG_DIR, "..", "..");
const TEMPLATES = path.join(REPO_ROOT, "templates");
const GUIDE = path.join(TEMPLATES, "mcp-client-guide.md");
const BUILD = path.join(TEMPLATES, "clients", "build.py");
const DERIVED = [
  path.join(TEMPLATES, "clients", "claude-skill", "SKILL.md"),
  path.join(TEMPLATES, "clients", "codex-AGENTS.md"),
  path.join(TEMPLATES, "clients", "gemini-GEMINI.md"),
  path.join(TEMPLATES, "clients", "cursor-llmwiki.mdc"),
];

const guide = readFileSync(GUIDE, "utf8");
/** `## agy` 조사 노트는 스니펫 본문이 아니다 — 줄 수·파생 대상에서 제외. */
const guideBody = guide.split(/^## agy$/m)[0];

function haveTool(cmd: string): boolean {
  return spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
}

describe("P3-02 정본 mcp-client-guide.md", () => {
  it("라우팅 표가 TOOLS 의 도구 이름을 전부 언급한다", () => {
    const tableLines = guideBody
      .split("\n")
      .filter((ln) => ln.trimStart().startsWith("|"))
      .join("\n");
    expect(tableLines).not.toBe("");
    for (const t of TOOLS) expect(tableLines, `routing table must mention ${t.name}`).toContain(t.name);
  });

  it("라우팅 표가 src/tools.ts 의 라우팅 규칙과 같은 파라미터를 쓴다", () => {
    expect(guideBody).toContain("wiki_expand(max≤6)");
    expect(guideBody).toContain("wiki_expand(rerank=11)");
    expect(guideBody).toContain("wiki_expand(max=8)");
    expect(guideBody).toContain("suggested_next");
  });

  it("규약 3줄(신뢰도 병기 · stale→superseded_by · 읽기 전용/wiki-ops)이 모두 있다", () => {
    expect(guideBody).toContain("신뢰도 병기");
    expect(guideBody).toContain("confidence");
    expect(guideBody).toContain("status: stale");
    expect(guideBody).toContain("superseded_by");
    expect(guideBody).toContain("읽기 전용");
    expect(guideBody).toContain("wiki-ops");
  });

  it("서버 자기서술로 스니펫이 선택 사항임을 밝힌다", () => {
    expect(guideBody).toMatch(/자기서술/);
  });

  it("content line ≤ 20 (빈 줄·agy 노트 제외)", () => {
    const lines = guideBody.split("\n").filter((ln) => ln.trim() !== "");
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it("agy 조사 결과가 기록돼 있다", () => {
    const agy = guide.split(/^## agy$/m)[1] ?? "";
    expect(agy.trim()).not.toBe("");
    expect(agy).toMatch(/\.agents\/skills|no rule-file mechanism found/);
  });
});

describe("P3-03 파생 스니펫", () => {
  it("파생 4종이 모두 존재한다", () => {
    for (const f of DERIVED) expect(existsSync(f), `${f} missing`).toBe(true);
  });

  it("각 파생 파일이 자동 생성 헤더를 담는다", () => {
    for (const f of DERIVED) {
      expect(readFileSync(f, "utf8")).toContain("자동 생성 — templates/mcp-client-guide.md 를 고치고 build.py 를 다시 돌려라");
    }
  });

  it("claude-skill 은 name/description frontmatter + 트리거 문구를 갖는다", () => {
    const s = readFileSync(DERIVED[0], "utf8");
    expect(s.startsWith("---\nname: llmwiki-query\n")).toBe(true);
    expect(s).toMatch(/^description: .+$/m);
    for (const trigger of ["위키에 뭐라고", "llmwiki 참고", "wiki 질의"]) expect(s).toContain(trigger);
  });

  it("cursor 규칙은 description + alwaysApply: false frontmatter 를 갖는다", () => {
    const s = readFileSync(DERIVED[3], "utf8");
    expect(s.startsWith("---\ndescription: ")).toBe(true);
    expect(s).toContain("\nalwaysApply: false\n---\n");
  });

  it("build.py --check — 파생이 정본에서 재생성한 바이트와 동일하다", () => {
    if (!haveTool("python3")) {
      // eslint-disable-next-line no-console
      console.error("SKIP: python3 not found — cannot verify templates/clients/build.py --check");
      return;
    }
    const r = spawnSync("python3", [BUILD, "--check"], { encoding: "utf8", cwd: REPO_ROOT, timeout: 30_000 });
    expect(r.status, `build.py --check failed:\n${r.stdout}${r.stderr}`).toBe(0);
  });
});
