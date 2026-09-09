// P1-36 — 대응표 #19: Python `str.split(sep, maxsplit)` 재현 (앞에서 maxsplit 번만 분리).
// python3 확인 (2026-09-09):
//   "a---b---c---d".split("---", 2) -> ['a', 'b', 'c---d']
//   "abc".split("---", 2)           -> ['abc']
//   "a---b".split("---", 5)         -> ['a', 'b']
//   "---x".split("---", 2)          -> ['', 'x']
//   "".split("---", 2)              -> ['']
import { describe, expect, it } from "vitest";
import { splitN } from "../../src/vault.js";

describe("P1-36 #19 splitN", () => {
  it("P1-36 #19 splitN('a---b---c---d','---',2) → ['a','b','c---d']", () => {
    expect(splitN("a---b---c---d", "---", 2)).toEqual(["a", "b", "c---d"]);
  });

  it("P1-36 #19 splitN: no separator → [s]", () => {
    expect(splitN("abc", "---", 2)).toEqual(["abc"]);
  });

  it("P1-36 #19 splitN: maxsplit larger than separator count → same as full split", () => {
    expect(splitN("a---b", "---", 5)).toEqual(["a", "b"]);
  });

  it("P1-36 #19 splitN: leading separator yields empty first element; empty string → ['']", () => {
    expect(splitN("---x", "---", 2)).toEqual(["", "x"]);
    expect(splitN("", "---", 2)).toEqual([""]);
  });

  it("P1-36 #19 splitN: maxsplit 0 → [s] (python 'a---b'.split('---', 0) -> ['a---b'])", () => {
    expect(splitN("a---b", "---", 0)).toEqual(["a---b"]);
  });

  it("P1-36 #19 splitN documents the JS trap: 'a---b---c---d'.split('---') has 4 parts, python maxsplit=2 has 3", () => {
    expect("a---b---c---d".split("---")).toHaveLength(4);
    expect(splitN("a---b---c---d", "---", 2)).toHaveLength(3);
  });
});
