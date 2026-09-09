// P1-37 — 대응표 #20: 관계 추출 `-\s*([\w-]+\s*::\s*\[\[[^\]]+\]\].*)$` (stripped line 에 re.match), 코드펜스 토글, `claim` 접두 제외.
// Python `\w` 는 유니코드(한국어 포함); JS `\w` 는 ASCII — TS 는 `[\p{L}\p{N}_-]` + u 플래그로 재현해야 한다.
// python3 확인 (2026-09-09) — do_pack 의 관계 루프를 그대로 실행한 결과:
//   input lines:
//     "- 사용함 :: [[x]]"                 -> '사용함 :: [[x]]'
//     "  - uses :: [[y]] (sources: 2)"   -> 'uses :: [[y]] (sources: 2)'   (indent stripped before match)
//     "```" / "- inside :: [[f]]" / "```" -> (excluded — inside fence)
//     "- claim:: [[z]] q"                -> (excluded — startswith claim)
//     "- claims_like :: [[w]]"           -> (excluded — 'claims_like'.lower().startswith('claim') is True)
//     "- depends_on::[[v]]  "            -> 'depends_on::[[v]]'
//     "- caused-by :: [[u]]"             -> 'caused-by :: [[u]]'
//     "- a b :: [[t]]"                   -> (no match — predicate must be [\w-]+ only)
//     "-uses :: [[s]]"                   -> 'uses :: [[s]]'          (\s* allows zero spaces)
//     "* uses :: [[r]]"                  -> (no match — must start with '-')
//     "- uses :: [[q|alias]] tail"       -> 'uses :: [[q|alias]] tail'
//     "- 관계1 :: [[p]]"                  -> '관계1 :: [[p]]'
//     "- é_x :: [[o]]"                   -> 'é_x :: [[o]]'
import { describe, expect, it } from "vitest";
import { extractRelations } from "../../src/pack.js";

describe("P1-37 #20 extractRelations", () => {
  it("P1-37 #20 extractRelations: Korean predicate '- 사용함 :: [[x]]' matched (python \\w is unicode)", () => {
    expect(extractRelations("- 사용함 :: [[x]]")).toEqual(["사용함 :: [[x]]"]);
    expect(extractRelations("- 관계1 :: [[p]]")).toEqual(["관계1 :: [[p]]"]);
    expect(extractRelations("- é_x :: [[o]]")).toEqual(["é_x :: [[o]]"]);
  });

  it("P1-37 #20 extractRelations: JS ASCII \\w trap documented — /^-\\s*[\\w-]+/ would NOT match the Korean line", () => {
    expect(/^-\s*[\w-]+\s*::/.test("- 사용함 :: [[x]]")).toBe(false);
    expect(extractRelations("- 사용함 :: [[x]]")).toHaveLength(1);
  });

  it("P1-37 #20 extractRelations: indented '  - uses :: [[y]] (sources: 2)' matched with trailing text kept", () => {
    expect(extractRelations("  - uses :: [[y]] (sources: 2)")).toEqual(["uses :: [[y]] (sources: 2)"]);
  });

  it("P1-37 #20 extractRelations: lines inside ``` fence are excluded", () => {
    expect(extractRelations("```\n- inside :: [[f]]\n```\n- after :: [[g]]")).toEqual(["after :: [[g]]"]);
    // fence opener with a language tag also toggles; the toggling is purely line-based
    expect(extractRelations("```python\n- inside :: [[f]]\n```")).toEqual([]);
    // unterminated fence swallows the rest of the document
    expect(extractRelations("```\n- inside :: [[f]]\n- also :: [[h]]")).toEqual([]);
  });

  it("P1-37 #20 extractRelations: '- claim:: [[z]] …' excluded (startswith claim)", () => {
    expect(extractRelations("- claim:: [[z]] q")).toEqual([]);
    expect(extractRelations("- CLAIM :: [[z]]")).toEqual([]); // lower() before startswith
  });

  it("P1-37 #20 extractRelations: '- claims_like :: [[w]]' excluded — python 'claims_like'.startswith('claim') is True", () => {
    expect(extractRelations("- claims_like :: [[w]]")).toEqual([]);
  });

  it("P1-37 #20 extractRelations: hyphen/underscore predicates, zero-space variants, trailing whitespace stripped", () => {
    expect(extractRelations("- depends_on::[[v]]  ")).toEqual(["depends_on::[[v]]"]);
    expect(extractRelations("- caused-by :: [[u]]")).toEqual(["caused-by :: [[u]]"]);
    expect(extractRelations("-uses :: [[s]]")).toEqual(["uses :: [[s]]"]);
    expect(extractRelations("- uses :: [[q|alias]] tail")).toEqual(["uses :: [[q|alias]] tail"]);
  });

  it("P1-37 #20 extractRelations: predicates with spaces or '*' bullets do not match", () => {
    expect(extractRelations("- a b :: [[t]]")).toEqual([]);
    expect(extractRelations("* uses :: [[r]]")).toEqual([]);
    expect(extractRelations("uses :: [[r]]")).toEqual([]); // no leading '-'
  });

  it("P1-37 #20 extractRelations: full mixed document equals python output in order", () => {
    const doc = [
      "- 사용함 :: [[x]]",
      "  - uses :: [[y]] (sources: 2)",
      "```",
      "- inside :: [[f]]",
      "```",
      "- claim:: [[z]] q",
      "- claims_like :: [[w]]",
      "- depends_on::[[v]]  ",
      "- caused-by :: [[u]]",
      "- a b :: [[t]]",
      "-uses :: [[s]]",
      "* uses :: [[r]]",
      "- uses :: [[q|alias]] tail",
      "- 관계1 :: [[p]]",
      "- é_x :: [[o]]",
    ].join("\n");
    expect(extractRelations(doc)).toEqual([
      "사용함 :: [[x]]",
      "uses :: [[y]] (sources: 2)",
      "depends_on::[[v]]",
      "caused-by :: [[u]]",
      "uses :: [[s]]",
      "uses :: [[q|alias]] tail",
      "관계1 :: [[p]]",
      "é_x :: [[o]]",
    ]);
  });
});
