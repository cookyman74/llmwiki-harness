// P1-31 — 대응표 #11: Python 문자열 비교(코드포인트 순) 재현. JS `<` 는 UTF-16 코드유닛 비교라 non-BMP 에서 역전.
// python3 확인 (2026-09-09):
//   '🦀' > '￦'                          -> True   (ord('🦀')=129408, ord('￦')=65510)
//   sorted(["zz-🦀-crab","zz-￦-won"])   -> ['zz-￦-won', 'zz-🦀-crab']
//   "a" < "ab"                          -> True
import { describe, expect, it } from "vitest";
import { cmpCodePoint } from "../../src/vault.js";

describe("P1-31 #11 cmpCodePoint", () => {
  it("P1-31 #11 cmpCodePoint: '🦀' sorts AFTER '￦' (U+FFE6) — python '🦀' > '￦' is True", () => {
    expect(cmpCodePoint("🦀", "￦")).toBe(1);
    expect(cmpCodePoint("￦", "🦀")).toBe(-1);
  });

  it("P1-31 #11 cmpCodePoint: sort(['zz-🦀-crab','zz-￦-won']) equals python sorted order", () => {
    // python: sorted(["zz-🦀-crab","zz-￦-won"]) -> ['zz-￦-won', 'zz-🦀-crab']
    expect(["zz-🦀-crab", "zz-￦-won"].sort(cmpCodePoint)).toEqual(["zz-￦-won", "zz-🦀-crab"]);
  });

  it("P1-31 #11 cmpCodePoint: JS default `<` gives the OPPOSITE order for the emoji pair (the trap)", () => {
    // UTF-16: '🦀' = D83E DD80 (lead surrogate 0xD83E < 0xFFE6) → JS thinks 🦀 < ￦
    expect("🦀" < "￦").toBe(true);
    expect(["zz-🦀-crab", "zz-￦-won"].sort()).toEqual(["zz-🦀-crab", "zz-￦-won"]);
    expect(["zz-🦀-crab", "zz-￦-won"].sort()).not.toEqual(["zz-🦀-crab", "zz-￦-won"].sort(cmpCodePoint));
  });

  it("P1-31 #11 cmpCodePoint: prefix — 'a' < 'ab' (python True)", () => {
    expect(cmpCodePoint("a", "ab")).toBe(-1);
    expect(cmpCodePoint("ab", "a")).toBe(1);
  });

  it("P1-31 #11 cmpCodePoint: equal strings → 0 (including non-BMP)", () => {
    expect(cmpCodePoint("", "")).toBe(0);
    expect(cmpCodePoint("가나", "가나")).toBe(0);
    expect(cmpCodePoint("zz-🦀", "zz-🦀")).toBe(0);
  });

  it("P1-31 #11 cmpCodePoint: empty string sorts first (python '' < 'a')", () => {
    expect(cmpCodePoint("", "a")).toBe(-1);
  });
});
