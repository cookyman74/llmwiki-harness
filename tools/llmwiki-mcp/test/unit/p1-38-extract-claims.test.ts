// P1-38 — 대응표 #18: claims `^-?\s*claim::\s*(.+)$` MULTILINE — **코드펜스 무시 없음**(관계 추출 #20 과 비대칭, 수정 금지).
// python3 확인 (2026-09-09):
//   [c.strip() for c in re.findall(r"^-?\s*claim::\s*(.+)$", text, re.MULTILINE)] on
//   "```\n- claim:: in fence\n```\n-  claim::  x \nclaim:: y\n* claim:: z\n  - claim:: indented\n- CLAIM:: upper\n- claim::\n- claim:: 가나 [[l]]\n\n\nclaim:: after blanks"
//   -> ['in fence', 'x', 'y', '- claim:: 가나 [[l]]', 'after blanks']
//   note: "  - claim:: indented" does NOT match (after ^ the optional '-' is missing, \s* eats spaces, then '-' ≠ 'c');
//         "- claim::" (empty) swallows the NEXT line via \s* crossing '\n' → group is '- claim:: 가나 [[l]]';
//         "claim:: after blanks" matches from the empty line (\s* spans blank lines).
import { describe, expect, it } from "vitest";
import { extractClaims, extractRelations } from "../../src/pack.js";

describe("P1-38 #18 extractClaims", () => {
  it("P1-38 #18 extractClaims: claim inside a ``` code fence IS included (no fence toggle for claims)", () => {
    expect(extractClaims("```\n- claim:: in fence\n```\n")).toEqual(["in fence"]);
    // asymmetry with relations (#20): the same fence hides a relation line
    expect(extractRelations("```\n- uses :: [[f]]\n```\n")).toEqual([]);
  });

  it("P1-38 #18 extractClaims: '-  claim::  x ' → 'x' (strip)", () => {
    expect(extractClaims("-  claim::  x ")).toEqual(["x"]);
  });

  it("P1-38 #18 extractClaims: 'claim:: y' without dash matched (regex ^-?)", () => {
    expect(extractClaims("claim:: y")).toEqual(["y"]);
  });

  it("P1-38 #18 extractClaims: '* claim:: z' NOT matched", () => {
    expect(extractClaims("* claim:: z")).toEqual([]);
  });

  it("P1-38 #18 extractClaims: indented '  - claim:: indented' NOT matched; 'CLAIM::' NOT matched (case-sensitive)", () => {
    expect(extractClaims("  - claim:: indented")).toEqual([]);
    expect(extractClaims("- CLAIM:: upper")).toEqual([]);
  });

  it("P1-38 #18 extractClaims: python \\s* crosses newlines — empty '- claim::' swallows the next line; blank lines before a claim are fine", () => {
    expect(extractClaims("- claim::\n- claim:: 가나 [[l]]")).toEqual(["- claim:: 가나 [[l]]"]);
    expect(extractClaims("\n\nclaim:: after blanks")).toEqual(["after blanks"]);
  });

  it("P1-38 #18 extractClaims: full mixed document equals python output in order", () => {
    const doc =
      "```\n- claim:: in fence\n```\n-  claim::  x \nclaim:: y\n* claim:: z\n  - claim:: indented\n- CLAIM:: upper\n- claim::\n- claim:: 가나 [[l]]\n\n\nclaim:: after blanks";
    expect(extractClaims(doc)).toEqual(["in fence", "x", "y", "- claim:: 가나 [[l]]", "after blanks"]);
  });
});
