/**
 * 3차 외부리뷰 MAJOR-3 — "wiki_pack 은 슬러그 30개 × 16 MiB 를 **다 읽고 나서** 자른다 → 수백 MB 가 이미 메모리에 올라온다".
 *
 * 수정 후 계약(pack.ts): `PACK_TOTAL_BYTES = 32 MiB`. 페이지를 하나 읽을 때마다 누적 원문 바이트를 확인해 초과하면
 * **다음 페이지를 읽지 않고** VaultLimitError 를 던진다 → 도구는 isError + "pack input exceeds …" 메시지를 돌려준다.
 * 12 MiB 페이지 3장(36 MiB)으로 초과를, 2장(24 MiB)으로 통과를 확인한다. 파일 쓰기는 beforeAll 에서 한 번만 한다.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACK_TOTAL_BYTES } from "../../src/pack.js";
import { MAX_FILE_BYTES } from "../../src/vault.js";
import { connect, text, type Connected } from "./p2-helpers.js";

const MIB = 1024 * 1024;
const PAGE_BYTES = 12 * MIB; // 파일당 상한(16 MiB)보다 작고, 3장이면 32 MiB 를 넘는다
const SLUGS = ["huge-1", "huge-2", "huge-3"];
const TIMEOUT = 120_000;

let root = "";
let c: Connected;

beforeAll(async () => {
  expect(PACK_TOTAL_BYTES).toBe(32 * MIB);
  expect(PAGE_BYTES).toBeLessThan(MAX_FILE_BYTES); // 파일 단위 상한에 먼저 걸리면 이 테스트는 무의미
  expect(PAGE_BYTES * 2).toBeLessThan(PACK_TOTAL_BYTES);
  expect(PAGE_BYTES * 3).toBeGreaterThan(PACK_TOTAL_BYTES);
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llmwiki-p2r3-pack-")));
  await mkdir(path.join(root, "wiki", "L3-semantic"), { recursive: true });
  const head = "---\ntype: fact\nconfidence: 0.85\n---\n";
  for (const slug of SLUGS) {
    await writeFile(path.join(root, "wiki", "L3-semantic", `${slug}.md`), `${head}${slug} ${"x".repeat(PAGE_BYTES - head.length - slug.length - 2)}\n`, "utf8");
  }
  await writeFile(path.join(root, "wiki", "L3-semantic", "small.md"), "---\ntype: concept\n---\n# small\n- claim:: 작은 주장\n", "utf8");
  c = await connect(root);
}, TIMEOUT);

afterAll(async () => {
  await c?.close();
  if (root) await rm(root, { recursive: true, force: true });
}, TIMEOUT);

describe("3차 MAJOR-3: pack 입력(원문 누적) 예산 32 MiB", () => {
  it(
    "12 MiB × 3 = 36 MiB → isError 'pack input exceeds' (읽는 도중 중단)",
    async () => {
      const r = await c.call("wiki_pack", { slugs: SLUGS });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("pack input exceeds");
      expect(text(r)).toContain(String(PACK_TOTAL_BYTES));
      expect(text(r)).not.toContain("\n"); // 한 줄 메시지
      expect(r.structuredContent).toBeUndefined(); // 오류 응답에는 구조화 본문이 없다
    },
    TIMEOUT,
  );

  it(
    "12 MiB × 2 = 24 MiB → 정상 응답(예산 이내)",
    async () => {
      const r = await c.call("wiki_pack", { slugs: SLUGS.slice(0, 2) });
      expect(r.isError, text(r)).toBeFalsy();
      expect(text(r)).toContain("huge-1");
      const sc = r.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(true); // 원문은 예산 안이지만 응답은 200 KB 로 잘린다(별개 예산)
    },
    TIMEOUT,
  );

  it(
    "없는 슬러그는 원문을 읽지 않으므로 예산을 소비하지 않는다 — 큰 페이지 2장 + 미존재 다수도 통과",
    async () => {
      const missing = Array.from({ length: 20 }, (_, i) => `nope-${i}`);
      const r = await c.call("wiki_pack", { slugs: [...SLUGS.slice(0, 2), ...missing] });
      expect(r.isError, text(r)).toBeFalsy();
    },
    TIMEOUT,
  );

  it(
    "예산 초과는 순서 의존 — 큰 페이지가 뒤에 와도 세 번째를 읽는 순간 실패한다",
    async () => {
      const r = await c.call("wiki_pack", { slugs: ["small", ...SLUGS] });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("pack input exceeds");
    },
    TIMEOUT,
  );
});
