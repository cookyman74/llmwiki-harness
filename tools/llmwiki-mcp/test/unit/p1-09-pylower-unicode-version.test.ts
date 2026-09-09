/**
 * #9 pyLower — Unicode 버전 차이 고정 (codex P1 2차 리뷰 BLOCKER-1).
 * Python 3.12.2 (unidata 15.0.0) 실측: 아래 코드포인트는 모두 `chr(cp).lower() == chr(cp)` (항등).
 * Node 24 (ICU 78, Unicode 17.0) `toLowerCase()` 는 이들을 소문자화한다 → pyLower 는 Python 결과를 내야 한다.
 */
import { describe, expect, it } from "vitest";
import { PY_LOWER_OVERRIDES } from "../../src/pylower-table.js";
import { pyLower } from "../../src/vault.js";

describe("#9 pyLower — Python 3.12 Unicode 15.0 기준 고정", () => {
  it("P1-63 #9 U+1C89·U+A7CB·U+10D50·U+16EA0 은 Python 에서 항등 — JS 가 소문자화해도 원문 유지", () => {
    // python3: [chr(c).lower()==chr(c) for c in (0x1C89,0xA7CB,0x10D50,0x16EA0)] -> [True, True, True, True]
    for (const cp of [0x1c89, 0xa7cb, 0x10d50, 0x16ea0]) {
      const ch = String.fromCodePoint(cp);
      expect(pyLower(ch)).toBe(ch);
      expect(pyLower(`abc ${ch} DEF`)).toBe(`abc ${ch} def`);
    }
  });
  it("P1-63 #9 오버라이드 테이블의 모든 항목이 Python 결과를 낸다(null=항등)", () => {
    for (const [cp, py] of PY_LOWER_OVERRIDES) {
      const ch = String.fromCodePoint(cp);
      const want = py === null ? ch : String.fromCodePoint(...py);
      expect(pyLower(ch)).toBe(want);
    }
    expect(PY_LOWER_OVERRIDES.size).toBeGreaterThan(0);
  });
  it("P1-63 #9 오버라이드 문자가 섞여도 Final_Sigma 등 문맥 규칙은 구간 안에서 유지된다", () => {
    // python3: ('ΣΑΣ ' + chr(0x1C89) + ' ΣΑΣ').lower() -> 'σας Ᲊ σας'
    const s = `ΣΑΣ ${String.fromCodePoint(0x1c89)} ΣΑΣ`;
    expect(pyLower(s)).toBe(`σας ${String.fromCodePoint(0x1c89)} σας`);
  });
  it("P1-63 #9 오버라이드가 없는 일반 문자열은 toLowerCase 와 동일(fast path)", () => {
    for (const s of ["Hello 한글 ÀÉ", "ΣΑΣ İ ǅ", "", "🦀 RERANK"]) expect(pyLower(s)).toBe(s.toLowerCase());
  });
});
