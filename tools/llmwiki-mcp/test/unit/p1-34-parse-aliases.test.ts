// P1-34 — 대응표 #6: aliases 파싱 — `re.findall(r"[^\[\],]+", aliases.strip("[] "))` → 각 `strip().strip("'\"")`, 빈 항목 제외.
// python3 확인 (2026-09-09):
//   '[a, \'b\', "c"]'              -> ['a', 'b', 'c']
//   '[]'                           -> []
//   ''                             -> []
//   'single'                       -> ['single']
//   '[ 벡터 인덱스 , vector index ]' -> ['벡터 인덱스', 'vector index']
//   '[[nested]]'                   -> ['nested']      (strip("[] ") removes ALL leading/trailing [ ] chars)
//   '[a,,b]'                       -> ['a', 'b']
//   "['']"                         -> []              (quotes stripped → empty → dropped)
//   '[[x]], y'                     -> ['x', 'y']
//   "[ 'a b' ]"                    -> ['a b']
//   '[[]]'                         -> []
import { describe, expect, it } from "vitest";
import { parseAliases, stripChars } from "../../src/vault.js";

describe("P1-34 #6 parseAliases", () => {
  it("P1-34 #6 parseAliases: mixed quoting \"[a, 'b', \\\"c\\\"]\" → [a, b, c]", () => {
    expect(parseAliases("[a, 'b', \"c\"]")).toEqual(["a", "b", "c"]);
  });

  it("P1-34 #6 parseAliases: '[]' → []", () => {
    expect(parseAliases("[]")).toEqual([]);
  });

  it("P1-34 #6 parseAliases: '' → []", () => {
    expect(parseAliases("")).toEqual([]);
  });

  it("P1-34 #6 parseAliases: bare 'single' → ['single']", () => {
    expect(parseAliases("single")).toEqual(["single"]);
  });

  it("P1-34 #6 parseAliases: Korean with inner spaces '[ 벡터 인덱스 , vector index ]' → ['벡터 인덱스','vector index']", () => {
    expect(parseAliases("[ 벡터 인덱스 , vector index ]")).toEqual(["벡터 인덱스", "vector index"]);
  });

  it("P1-34 #6 parseAliases: '[[nested]]' → ['nested'] (python strip('[] ') is a char-set strip, not a prefix strip)", () => {
    // python: re.findall(r"[^\[\],]+", "[[nested]]".strip("[] ")) -> ['nested']
    expect(parseAliases("[[nested]]")).toEqual(["nested"]);
    expect(stripChars("[[nested]]", "[] ")).toBe("nested");
  });

  it("P1-34 #6 parseAliases: empty items are dropped — '[a,,b]' → [a,b]; \"['']\" → []; '[[]]' → []", () => {
    expect(parseAliases("[a,,b]")).toEqual(["a", "b"]);
    expect(parseAliases("['']")).toEqual([]);
    expect(parseAliases("[[]]")).toEqual([]);
  });

  it("P1-34 #6 parseAliases: inner brackets act as separators — '[[x]], y' → ['x','y']", () => {
    expect(parseAliases("[[x]], y")).toEqual(["x", "y"]);
  });

  it("P1-34 #6 parseAliases: quoted alias with space \"[ 'a b' ]\" → ['a b']", () => {
    expect(parseAliases("[ 'a b' ]")).toEqual(["a b"]);
  });

  it("P1-34 #6 stripChars: strips a character SET from both ends, not a literal string", () => {
    // python: " ][ x ] [".strip("[] ") -> 'x'
    expect(stripChars(" ][ x ] [", "[] ")).toBe("x");
    // python: "abcba".strip("ab") -> 'c'
    expect(stripChars("abcba", "ab")).toBe("c");
    // python: "🦀a🦀".strip("🦀") -> 'a'   (code-point aware)
    expect(stripChars("🦀a🦀", "🦀")).toBe("a");
  });
});
