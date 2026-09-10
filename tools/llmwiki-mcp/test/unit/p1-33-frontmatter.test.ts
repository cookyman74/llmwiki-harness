// P1-33 — 대응표 #3: `frontmatter(text)` — 첫 줄 `---`, 이후 lines[1:201](200줄) 안에서 닫는 `---`.
// python3 확인 (2026-09-09) — scope-expand.py 의 frontmatter() 를 그대로 실행:
//   199 body lines + "---"  -> 199 lines returned      (closing at index 200, inside lines[1:201])
//   200 body lines + "---"  -> ''                      (closing at index 201, outside the window)
//   201 body lines + "---"  -> ''
//   frontmatter("---  \ntype: fact\n---\n") -> 'type: fact'   (strip() 로 후행 공백 허용)
//   frontmatter("")          -> ''
//   frontmatter("x\n---\n")  -> ''
import { describe, expect, it } from "vitest";
import { frontmatter } from "../../src/vault.js";

function withBody(n: number): string {
  const body = Array.from({ length: n }, (_, i) => `k${i}: v`).join("\n");
  return `---\n${body}\n---\nbody`;
}

describe("P1-33 #3 frontmatter", () => {
  it("P1-33 #3 frontmatter: closed within 200 lines → content", () => {
    expect(frontmatter("---\ntype: fact\ntitle: x\n---\nbody")).toBe("type: fact\ntitle: x");
    const fm199 = frontmatter(withBody(199));
    expect(fm199.split("\n")).toHaveLength(199);
    expect(fm199.startsWith("k0: v\n")).toBe(true);
    expect(fm199.endsWith("\nk198: v")).toBe(true);
  });

  it("P1-33 #3 frontmatter: closing `---` on line 202+ (index ≥ 201) → ''", () => {
    expect(frontmatter(withBody(200))).toBe(""); // closing at index 201 — first line outside lines[1:201]
    expect(frontmatter(withBody(201))).toBe("");
    expect(frontmatter(withBody(500))).toBe("");
  });

  it("P1-33 #3 frontmatter: first line not `---` → ''", () => {
    expect(frontmatter("x\n---\n")).toBe("");
    expect(frontmatter("# title\n---\ntype: fact\n---\n")).toBe("");
    expect(frontmatter("----\ntype: fact\n---\n")).toBe(""); // '----'.strip() != '---'
  });

  it("P1-33 #3 frontmatter: first line '---  ' with trailing spaces is still recognized (strip)", () => {
    expect(frontmatter("---  \ntype: fact\n---\n")).toBe("type: fact");
    expect(frontmatter("---\ntype: fact\n---   \n")).toBe("type: fact"); // closing line also stripped
    expect(frontmatter("\t---\ntype: fact\n---\n")).toBe("type: fact"); // leading whitespace too (python strip())
  });

  it("P1-33 #3 frontmatter: empty text → ''", () => {
    expect(frontmatter("")).toBe("");
  });

  it("P1-33 #3 frontmatter: unterminated block → ''; immediately closed → ''", () => {
    expect(frontmatter("---\ntype: fact\n")).toBe("");
    // python: frontmatter("---\n---\nbody") -> ''  ("\n".join([]) == '')
    expect(frontmatter("---\n---\nbody")).toBe("");
  });
});
