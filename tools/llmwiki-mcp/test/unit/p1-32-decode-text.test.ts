// P1-32 — 대응표 #2: `open(path, encoding="utf-8-sig", errors="replace")` 텍스트 모드 read 재현
// (BOM 제거·잘못된 바이트 U+FFFD·universal newlines).
// python3 확인 (2026-09-09):
//   b"\xef\xbb\xbfx".decode("utf-8-sig")              -> 'x'
//   b"a\xef\xbb\xbfb".decode("utf-8-sig")             -> 'a\ufeffb'   (BOM 은 맨 앞에서만 제거)
//   b"a\xffb".decode("utf-8","replace")               -> 'a�b'
//   b"\xff\xff".decode("utf-8","replace")             -> '��'
//   b"\xe2\x82".decode("utf-8","replace")             -> '�'      (truncated sequence → 1개)
//   open(p, encoding="utf-8-sig", errors="replace").read()  with bytes EF BB BF 'a\r\nb\rc\n' -> 'a\nb\nc\n'
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeText, read } from "../../src/vault.js";

describe("P1-32 #2 decodeText / read", () => {
  it("P1-32 #2 decodeText: leading BOM (EF BB BF) is removed", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x78]))).toBe("x");
  });

  it("P1-32 #2 decodeText: CRLF → LF", () => {
    expect(decodeText(new TextEncoder().encode("a\r\nb\r\n"))).toBe("a\nb\n");
  });

  it("P1-32 #2 decodeText: lone CR → LF (universal newlines)", () => {
    expect(decodeText(new TextEncoder().encode("a\rb\rc"))).toBe("a\nb\nc");
  });

  it("P1-32 #2 decodeText: invalid byte 0xFF → U+FFFD (one per invalid byte)", () => {
    expect(decodeText(new Uint8Array([0x61, 0xff, 0x62]))).toBe("a�b");
    expect(decodeText(new Uint8Array([0xff, 0xff]))).toBe("��");
    // truncated 3-byte sequence → single U+FFFD (python and WHATWG agree)
    expect(decodeText(new Uint8Array([0xe2, 0x82]))).toBe("�");
  });

  it("P1-32 #2 decodeText: BOM in the middle is KEPT (utf-8-sig strips only the leading one)", () => {
    expect(decodeText(new Uint8Array([0x61, 0xef, 0xbb, 0xbf, 0x62]))).toBe("a\ufeffb");
  });

  it("P1-32 #2 decodeText: only ONE leading BOM is stripped (python utf-8-sig)", () => {
    // python: b"\xef\xbb\xbf\xef\xbb\xbfx".decode("utf-8-sig") -> '\ufeffx'
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x78]))).toBe("\ufeffx");
  });

  it("P1-32 #2 read: file with BOM + CRLF + lone CR → 'a\\nb\\nc\\n'; missing file → ''", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llmwiki-p1-32-"));
    try {
      const p = path.join(dir, "t.md");
      await fs.writeFile(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\rc\n", "utf8")]));
      expect(await read(p)).toBe("a\nb\nc\n");
      expect(await read(path.join(dir, "does-not-exist.md"))).toBe(""); // python read(): OSError → ""
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
