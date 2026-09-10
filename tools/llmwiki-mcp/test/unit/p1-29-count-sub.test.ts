// P1-29 — 대응표 #10: Python `str.count(sub)` (비중첩) 재현.
// 기대값은 python3 로 실행해 확인 (2026-09-09, Python 3.12.2).
import { describe, expect, it } from "vitest";
import { countSub } from "../../src/vault.js";

describe("P1-29 #10 countSub", () => {
  it("P1-29 #10 countSub: non-overlapping count — 'aaaa'.count('aa') == 2", () => {
    // python: "aaaa".count("aa") -> 2
    expect(countSub("aaaa", "aa")).toBe(2);
  });

  it("P1-29 #10 countSub: empty haystack → 0", () => {
    // python: "".count("x") -> 0
    expect(countSub("", "x")).toBe(0);
  });

  it("P1-29 #10 countSub: empty needle → 0 (documented divergence: python 'abc'.count('') == 4; callers filter empty terms)", () => {
    // python: "abc".count("") -> 4   — TS 는 의도적으로 0 (vault.ts 주석). 호출부 normalizeTerms 가 빈 term 을 걸러내므로 도달 불가.
    expect(countSub("abc", "")).toBe(0);
  });

  it("P1-29 #10 countSub: Korean — '가나가나가'.count('가나') == 2", () => {
    // python: "가나가나가".count("가나") -> 2
    expect(countSub("가나가나가", "가나")).toBe(2);
  });

  it("P1-29 #10 countSub: overlapping-only pattern counts once — 'aaa'.count('aa') == 1", () => {
    // python: "aaa".count("aa") -> 1
    expect(countSub("aaa", "aa")).toBe(1);
  });

  it("P1-29 #10 countSub: needle longer than haystack → 0", () => {
    // python: "a".count("ab") -> 0
    expect(countSub("a", "ab")).toBe(0);
  });
});
