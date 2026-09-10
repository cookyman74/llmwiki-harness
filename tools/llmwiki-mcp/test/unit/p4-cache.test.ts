/**
 * P4-07 · P4-08 · P4-10 — 프로세스 내 mtime 캐시.
 *
 * 캐시의 위험은 속도가 아니라 **낡은 결과**다. 그래서 여기서는 전부 "파일을 실제로 바꾸고 다음 호출을
 * 확인"하는 방식으로만 판정한다(P4 교훈 1). 다루는 축:
 *   ① 적중(같은 스냅샷 → 같은 Graph 객체)  ② 수정·추가·삭제  ③ mtime 만 변경(클라우드 동기)
 *   ④ 타임스탬프 해상도 안의 수정(같은 크기·같은 mtime)  ⑤ `--root` 전환  ⑥ `LLMWIKI_CACHE=0`
 *   ⑦ 심볼릭 링크 스킵·경계(P2-17)가 캐시 경로에서도 유지되는가  ⑧ 캐시 on/off 출력 동일
 */
import { chmod, mkdtemp, mkdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FUTURE_SKEW_MS, cacheStats, getGraph, readTexts, resetCache, setCacheBudgetsForTest, snapshot } from "../../src/cache.js";
import { walkMd } from "../../src/vault.js";
import { buildGraph } from "../../src/graph.js";
import { runExpand, runSearch } from "../../src/once.js";

let root = "";
const wiki = (): string => path.join(root, "wiki");

/** 파일을 쓰고 mtime 을 과거로 돌린다 — "방금 수정" 창(FRESH_WINDOW_MS) 밖으로 보내 캐시 대상이 되게. */
async function write(rel: string, text: string, ageSec = 30): Promise<void> {
  const p = path.join(wiki(), rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text, "utf8");
  const t = Date.now() / 1000 - ageSec;
  await utimes(p, t, t);
}

beforeEach(async () => {
  delete process.env.LLMWIKI_CACHE;
  resetCache();
  root = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p4-cache-"));
  await write("L3/a.md", "---\ntype: concept\n---\n# A\nalpha 본문. [[b]]\n");
  await write("L3/b.md", "---\ntype: concept\n---\n# B\nbeta 본문. [[a]]\n");
});

afterEach(async () => {
  delete process.env.LLMWIKI_CACHE;
  resetCache();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("P4-06 적중·무효화", () => {
  it("스냅샷이 같으면 같은 Graph 객체를 돌려준다(파생 메모까지 재사용)", async () => {
    const g1 = await buildGraph(wiki());
    const g2 = await buildGraph(wiki());
    expect(g2).toBe(g1);
    expect(cacheStats().hasGraph).toBe(true);
    expect(cacheStats().cachedFiles).toBe(2);
  });

  it("P4-07 파일 수정 → 다음 호출에 반영되고 그래프 객체가 교체된다", async () => {
    const g1 = await buildGraph(wiki());
    expect(g1.nodes.get("a")?.text).toContain("alpha 본문");
    await write("L3/a.md", "---\ntype: concept\n---\n# A\n감마 본문. [[b]]\n");
    const g2 = await buildGraph(wiki());
    expect(g2).not.toBe(g1);
    expect(g2.nodes.get("a")?.text).toContain("감마 본문");
    expect(g2.nodes.get("a")?.text).not.toContain("alpha");
  });

  it("P4-07 파일 추가·삭제가 다음 호출에 반영된다(인링크 포함 통째 재구성)", async () => {
    await buildGraph(wiki());
    await write("L3/c.md", "---\ntype: fact\n---\n# C\n[[a]]\n");
    const g2 = await buildGraph(wiki());
    expect([...g2.nodes.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(g2.nodes.get("a")?.in.has("c")).toBe(true); // 인링크가 새로 만들어졌다

    await rm(path.join(wiki(), "L3/c.md"));
    const g3 = await buildGraph(wiki());
    expect([...g3.nodes.keys()].sort()).toEqual(["a", "b"]);
    expect(g3.nodes.get("a")?.in.has("c")).toBe(false);
    expect(cacheStats().cachedFiles).toBe(2); // 삭제된 파일의 텍스트도 캐시에서 사라진다
  });

  it("P4-07 mtime 만 바뀌고 내용이 같으면(클라우드 동기) 결과가 그대로다", async () => {
    const g1 = await buildGraph(wiki());
    const p = path.join(wiki(), "L3/a.md");
    const t = Date.now() / 1000 - 5;
    await utimes(p, t, t);
    const g2 = await buildGraph(wiki());
    expect(g2).not.toBe(g1); // 스냅샷이 달라 다시 만든다(낡은 결과보다 재구성을 택한다)
    expect(g2.nodes.get("a")?.text).toBe(g1.nodes.get("a")?.text);
  });

  it("P4-07 타임스탬프 해상도 안(2s)의 수정은 캐시하지 않아 낡은 결과가 나오지 않는다", async () => {
    // 방금 쓴 파일 = mtime 이 현재. 스냅샷이 저장되지 않으므로 다음 호출은 반드시 다시 읽는다.
    const p = path.join(wiki(), "L3/a.md");
    await writeFile(p, "---\ntype: concept\n---\n# A\nAAAA\n", "utf8");
    const st = await stat(p);
    await buildGraph(wiki());
    expect(cacheStats().hasGraph).toBe(false); // 저장 자체를 하지 않았다

    // 같은 크기·같은 mtime 으로 내용만 교체 — 스냅샷으로는 구분할 수 없는 최악의 경우.
    await writeFile(p, "---\ntype: concept\n---\n# A\nBBBB\n", "utf8");
    await utimes(p, st.mtime, st.mtime);
    const g2 = await buildGraph(wiki());
    expect(g2.nodes.get("a")?.text).toContain("BBBB");
  });

  it("P4-04 `--root` 가 바뀌면 이전 볼트의 캐시를 쓰지 않는다", async () => {
    await buildGraph(wiki());
    const other = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p4-other-"));
    try {
      const op = path.join(other, "wiki", "L3");
      await mkdir(op, { recursive: true });
      await writeFile(path.join(op, "z.md"), "---\ntype: fact\n---\n# Z\nzeta\n", "utf8");
      const t = Date.now() / 1000 - 30;
      await utimes(path.join(op, "z.md"), t, t);
      const g = await buildGraph(path.join(other, "wiki"));
      expect([...g.nodes.keys()]).toEqual(["z"]);
      expect(cacheStats().root).toBe(path.resolve(path.join(other, "wiki")));
      // 원래 볼트로 돌아오면 그쪽을 다시 만든다
      const back = await buildGraph(wiki());
      expect([...back.nodes.keys()].sort()).toEqual(["a", "b"]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

describe("P4-05 LLMWIKI_CACHE=0", () => {
  it("끄면 아무것도 저장하지 않고 매번 새 그래프를 만든다", async () => {
    process.env.LLMWIKI_CACHE = "0";
    const g1 = await buildGraph(wiki());
    const g2 = await buildGraph(wiki());
    expect(g2).not.toBe(g1);
    expect(cacheStats().hasGraph).toBe(false);
    expect(cacheStats().cachedFiles).toBe(0);
    expect([...g2.nodes.keys()].sort()).toEqual([...g1.nodes.keys()].sort());
  });

  it("P4-08 캐시 on/off 출력이 같다(expand·rerank·search, 수정 전후 모두)", async () => {
    const opts = { root, topSeed: 6, max: 15, rerank: 0 };
    const rr = { ...opts, rerank: 11 };
    const runBoth = async (): Promise<{ on: string[]; off: string[] }> => {
      process.env.LLMWIKI_CACHE = "0";
      resetCache();
      const off = [await runExpand(["alpha"], opts), await runExpand(["alpha"], rr), await runSearch(["alpha"], root, 8)];
      delete process.env.LLMWIKI_CACHE;
      resetCache();
      const first = [await runExpand(["alpha"], opts), await runExpand(["alpha"], rr), await runSearch(["alpha"], root, 8)];
      // 두 번째 라운드는 캐시 적중 상태에서 — 적중이 출력을 바꾸지 않는지까지 본다
      const on = [await runExpand(["alpha"], opts), await runExpand(["alpha"], rr), await runSearch(["alpha"], root, 8)];
      expect(on).toEqual(first);
      return { on, off };
    };

    const before = await runBoth();
    expect(before.on).toEqual(before.off);

    await write("L3/b.md", "---\ntype: concept\n---\n# B\nalpha 도 들어간 본문. [[a]]\n");
    const after = await runBoth();
    expect(after.on).toEqual(after.off);
    expect(after.on).not.toEqual(before.on); // 수정이 실제로 반영됐다
  });
});

describe("P4-10 보안 규칙이 캐시 경로에서도 유지된다", () => {
  it("캐시 적중 상태에서 심볼릭 링크를 넣어도 여전히 건너뛴다(경계 밖 내용 미노출)", async () => {
    const outside = path.join(root, "outside-secret.md");
    await writeFile(outside, "---\ntype: fact\n---\n# OUTSIDE\nTOPSECRET-CANARY\n", "utf8");
    const g1 = await buildGraph(wiki());
    expect(cacheStats().hasGraph).toBe(true);

    let linked = true;
    try {
      await symlink(outside, path.join(wiki(), "L3", "leak.md"));
    } catch {
      linked = false; // 권한 없는 환경(Windows 등) — 링크를 못 만들면 이 단언은 건너뛴다
    }
    if (!linked) return;

    const g2 = await buildGraph(wiki());
    expect([...g2.nodes.keys()].sort()).toEqual(["a", "b"]);
    expect(JSON.stringify([...g2.nodes.values()])).not.toContain("TOPSECRET-CANARY");
    expect(g2).toBe(g1); // 링크는 순회에서 빠지므로 스냅샷도 그대로 = 적중이 정상
  });

  it("실제 파일이 심볼릭 링크로 교체되면 목록이 바뀌어 그래프를 다시 만든다", async () => {
    const outside = path.join(root, "outside2.md");
    await writeFile(outside, "---\ntype: fact\n---\n# O2\nCANARY-2\n", "utf8");
    await buildGraph(wiki());
    const target = path.join(wiki(), "L3", "b.md");
    await rm(target);
    let linked = true;
    try {
      await symlink(outside, target);
    } catch {
      linked = false;
    }
    if (!linked) return;
    const g2 = await buildGraph(wiki());
    expect([...g2.nodes.keys()]).toEqual(["a"]);
    expect(JSON.stringify([...g2.nodes.values()])).not.toContain("CANARY-2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 외부리뷰(2026-09-10 codex·agy) 반영 회귀 — 지적된 구멍을 그대로 재현해 막는다.
// ─────────────────────────────────────────────────────────────────────────────
describe("외부리뷰 반영 회귀", () => {
  it("[codex B1·agy M2] mtime·size 를 복원해도 내용이 바뀌면 적중하지 않는다(ctime 방어)", async () => {
    const p = path.join(wiki(), "L3/a.md");
    const before = await stat(p);
    const g1 = await buildGraph(wiki());
    expect(g1.nodes.get("a")?.text).toContain("alpha 본문");

    // `cp -p`·`rsync --times`·`touch -t` 가 하는 일: 같은 크기로 내용을 바꾸고 mtime 을 되돌린다.
    const original = "---\ntype: concept\n---\n# A\nalpha 본문. [[b]]\n";
    const swapped = original.replace("alpha", "AAAAA"); // 같은 바이트 수(ASCII 5자)
    expect(Buffer.byteLength(swapped)).toBe(Buffer.byteLength(original)); // 크기 동일
    await writeFile(p, swapped, "utf8");
    await utimes(p, before.atime, before.mtime); // mtime 복원 — 그래도 ctime 은 올라간다

    const g2 = await buildGraph(wiki());
    expect(g2.nodes.get("a")?.text).toContain("AAAAA");
    expect(g2.nodes.get("a")?.text).not.toContain("alpha");
  });

  // Windows 의 chmod 는 읽기 전용 비트만 바꾸므로 0o600↔0o644 가 무변경일 수 있다 — POSIX 에서만 판정.
  it.skipIf(process.platform === "win32")("[codex M3] 권한만 바뀌어도(chmod) 다시 읽는다", async () => {
    const p = path.join(wiki(), "L3/a.md");
    const g1 = await buildGraph(wiki());
    await chmod(p, 0o600);
    const g2 = await buildGraph(wiki());
    expect(g2).not.toBe(g1); // mode·ctime 이 키에 있으므로 미스
    await chmod(p, 0o644);
  });

  it("[agy B1] 미래 mtime 파일이 있어도 캐시가 무력화되지 않는다", async () => {
    const p = path.join(wiki(), "L3/a.md");
    const future = new Date(Date.now() + 3600_000); // 1시간 뒤 — 다른 머신에서 동기된 파일
    await utimes(p, future, future);
    const g1 = await buildGraph(wiki());
    const g2 = await buildGraph(wiki());
    expect(cacheStats().hasGraph).toBe(true);
    expect(g2).toBe(g1);
  });

  it("[agy B2] 수정을 반복해도 파생 예산이 소진되지 않는다(그래프 수명과 함께 리셋)", async () => {
    for (let i = 0; i < 12; i++) {
      await write("L3/a.md", `---\ntype: concept\n---\n# A\nalpha 본문 ${i}. [[b]]\n`);
      await runExpand(["alpha"], { root, topSeed: 6, max: 15, rerank: 11 });
      // 매 라운드 그래프가 새로 조립되므로 예산은 살아 있는 그래프 몫만 남는다
      expect(cacheStats().derivedBytes).toBeLessThan(64 * 1024); // 미니 볼트 = 수 KB 규모
    }
  });

  it("[리뷰 MINOR] 두 볼트를 번갈아 조회해도 각자 캐시가 살아 있다", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p4-alt-"));
    try {
      const dir = path.join(other, "wiki", "L3");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "z.md"), "---\ntype: fact\n---\n# Z\nzeta\n", "utf8");
      const t = Date.now() / 1000 - 30;
      await utimes(path.join(dir, "z.md"), t, t);

      const a1 = await buildGraph(wiki());
      const b1 = await buildGraph(path.join(other, "wiki"));
      const a2 = await buildGraph(wiki()); // 다른 볼트를 거친 뒤에도 적중해야 한다
      const b2 = await buildGraph(path.join(other, "wiki"));
      expect(a2).toBe(a1);
      expect(b2).toBe(b1);
      expect(cacheStats().roots).toBe(2);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("[리뷰 MINOR] search 가 채운 텍스트 캐시를 graph 가 이어받아도 결과가 같다", async () => {
    const viaSearchFirst = [await runSearch(["alpha"], root, 8), await runExpand(["alpha"], { root, topSeed: 6, max: 15, rerank: 0 })];
    resetCache();
    const viaGraphFirst = [await runSearch(["alpha"], root, 8), await runExpand(["alpha"], { root, topSeed: 6, max: 15, rerank: 0 })];
    expect(viaSearchFirst).toEqual(viaGraphFirst);

    // 수정 후에도 두 경로가 같은 것을 본다
    await write("L3/b.md", "---\ntype: concept\n---\n# B\nalpha 추가. [[a]]\n");
    const s2 = await runSearch(["alpha"], root, 8);
    const e2 = await runExpand(["alpha"], { root, topSeed: 6, max: 15, rerank: 0 });
    expect(s2).toContain("b");
    expect(e2).toContain("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 외부리뷰 2차(2026-09-10 codex) 반영 회귀
// ─────────────────────────────────────────────────────────────────────────────
describe("외부리뷰 2차 반영 회귀", () => {
  afterEach(() => setCacheBudgetsForTest(null));

  it("[codex r2 B1] 불안정 스냅샷은 키가 같아도 그래프 적중·텍스트 재사용을 하지 않는다", async () => {
    const base = wiki();
    await buildGraph(base); // 안정 스냅샷으로 저장
    const files = await walkMd(base);
    const snap = await snapshot(base, files); // 저장된 것과 같은 신원·같은 키
    expect(getGraph(base, snap)).not.toBeNull(); // 안정이면 적중

    // 디스크 내용은 바뀌었는데 이 스냅샷 객체는 옛 신원을 들고 있다 — 옛 코드는 여기서 캐시 텍스트를 재사용했다.
    await writeFile(path.join(base, "L3/a.md"), "---\ntype: concept\n---\n# A\nNEWTEXT. [[b]]\n", "utf8");
    snap.storable = false; // '방금 수정' 창 안이라고 판정된 상황
    expect(getGraph(base, snap)).toBeNull();
    const texts = await readTexts(base, files, snap);
    expect(texts[files.findIndex((f) => f.slug === "a")]).toContain("NEWTEXT");
  });

  it("[codex r2 m2] FUTURE_SKEW_MS 경계 — 창 안의 미래 mtime 은 불안정, 창 밖은 안정", async () => {
    const p = path.join(wiki(), "L3/a.md");
    const inside = new Date(Date.now() + FUTURE_SKEW_MS / 2);
    await utimes(p, inside, inside);
    await buildGraph(wiki());
    expect(cacheStats(wiki()).hasGraph).toBe(false);

    resetCache();
    const beyond = new Date(Date.now() + FUTURE_SKEW_MS * 12);
    await utimes(p, beyond, beyond);
    await buildGraph(wiki());
    expect(cacheStats(wiki()).hasGraph).toBe(true);
  });

  it("[codex r2 M1] 텍스트 예산을 넘으면 그래프도 저장하지 않는다(그래프가 본문을 쥐고 있으므로)", async () => {
    setCacheBudgetsForTest({ text: 16 }); // 미니 볼트 본문보다 작게
    const g1 = await buildGraph(wiki());
    const g2 = await buildGraph(wiki());
    expect(cacheStats(wiki()).hasGraph).toBe(false);
    expect(cacheStats(wiki()).cachedFiles).toBe(0);
    expect(g2).not.toBe(g1);
    expect([...g2.nodes.keys()].sort()).toEqual(["a", "b"]); // 결과는 그대로
  });

  it("[codex r2 M1] 파생 예산은 살아 있는 전 root 의 합으로 지켜진다", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "llmwiki-p4-der-"));
    try {
      const dir = path.join(other, "wiki", "L3");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "z.md"), "---\ntype: fact\n---\n# Z\nalpha zeta\n", "utf8");
      const t = Date.now() / 1000 - 30;
      await utimes(path.join(dir, "z.md"), t, t);

      setCacheBudgetsForTest({ derived: 120 });
      const o = { topSeed: 6, max: 15, rerank: 11 };
      const r1 = await runExpand(["alpha"], { root, ...o });
      const r2 = await runExpand(["alpha"], { root: other, ...o });
      expect(cacheStats().derivedBytes).toBeLessThanOrEqual(120);
      // 예산에 막혀 메모를 못 해도 출력은 같다
      setCacheBudgetsForTest(null);
      resetCache();
      expect(await runExpand(["alpha"], { root, ...o })).toBe(r1);
      expect(await runExpand(["alpha"], { root: other, ...o })).toBe(r2);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("[codex r2 m1] root 축출은 LRU — 최근에 쓴 root 는 살아남는다", async () => {
    const extra: string[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const d = await mkdtemp(path.join(os.tmpdir(), `llmwiki-p4-lru${i}-`));
        const dir = path.join(d, "wiki", "L3");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "x.md"), "---\ntype: fact\n---\n# X\nx\n", "utf8");
        const t = Date.now() / 1000 - 30;
        await utimes(path.join(dir, "x.md"), t, t);
        extra.push(d);
      }
      const w = (d: string): string => path.join(d, "wiki");
      await buildGraph(wiki()); // A
      for (const d of extra.slice(0, 3)) await buildGraph(w(d)); // B C D → 4개 꽉 참
      await buildGraph(wiki()); // A 를 다시 사용 — LRU 갱신
      await buildGraph(w(extra[3])); // E → 가장 오래 안 쓴 B 가 축출돼야 한다
      expect(cacheStats(wiki()).hasGraph).toBe(true);
      expect(cacheStats(w(extra[0])).root).toBeNull();
      expect(cacheStats().roots).toBe(4);
    } finally {
      for (const d of extra) await rm(d, { recursive: true, force: true });
    }
  });
});
