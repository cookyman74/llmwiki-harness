/**
 * cache.ts — 프로세스 내 mtime 캐시 (P4-02~P4-06, P4-13+).
 *
 * 서버는 장수 프로세스인데 호출마다 볼트를 통째로 다시 읽고 그래프를 다시 만든다. 여기서
 * **파일 스냅샷이 같으면** 그 결과를 재사용한다. 규칙은 정확성 우선이다:
 *
 *  1. 순회(`walkMd`)와 경계 검사는 **호출마다 그대로 수행**한다. 캐시는 순회 결과 뒤에 붙으므로
 *     심볼릭 링크 스킵·realpath 경계(P2-17)를 우회할 수 없다(P4-10).
 *  2. 캐시 키는 전 파일의 `(상대경로, mtimeMs, size)` 스냅샷이다(P4-02). 파일 추가·삭제·수정·
 *     `--root` 변경은 전부 키를 바꾼다(P4-04).
 *  3. 스냅샷이 다르면 **바뀐 파일만 다시 읽고**, 그래프(정규화·인링크)는 통째로 다시 만든다(P4-03).
 *  4. `mtime` 이 아주 최근(2s 이내)인 파일이 있으면 그 스냅샷은 **저장하지 않는다**. 파일시스템
 *     타임스탬프 해상도(FAT/exFAT 2s, 일부 클라우드 동기 폴더) 안에서 크기까지 같은 수정이 일어나면
 *     스냅샷으로 구분할 수 없기 때문이다 — 낡은 결과를 주느니 다시 읽는다.
 *  5. `LLMWIKI_CACHE=0` 이면 전 경로가 꺼진다(P4-05). 패리티·디버그용.
 *
 * 파생값(P4-13+): lex haystack·bm25 `scoreText`·`dl` 은 **term 과 무관**해서 호출 사이에 재사용할 수
 * 있다. 노드 객체에 WeakMap 으로 달아 두므로 그래프가 교체되면 함께 사라진다. 문자열 누적이
 * `DERIVED_BUDGET_BYTES` 를 넘으면 그 뒤로는 메모하지 않는다(메모리 상한 부재 위험 차단).
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Graph, Node } from "./graph.js";
import { MAX_TOTAL_BYTES, VaultLimitError, read, type MdFile } from "./vault.js";

/** 파일시스템 타임스탬프 해상도 안(2s)에 수정된 파일이 있으면 스냅샷을 신뢰하지 않는다. */
export const FRESH_WINDOW_MS = 2000;
/** 파생 문자열(haystack·scoreText) 메모 총량 상한. 넘으면 그 뒤로는 메모하지 않는다. */
export const DERIVED_BUDGET_BYTES = 128 * 1024 * 1024;

export function cacheEnabled(): boolean {
  return process.env.LLMWIKI_CACHE !== "0";
}

export interface Snapshot {
  /** 파일 목록·mtime·size 를 담은 키. 하나라도 다르면 캐시 미스. */
  key: string;
  /** false 면 저장하지 않는다(최근 수정 파일 포함 — 규칙 4). */
  storable: boolean;
  /** 파일별 (mtimeMs, size) — 바뀐 파일만 다시 읽을 때 쓴다. */
  stats: Map<string, { mtimeMs: number; size: number }>;
}

/** 순회 결과에 stat 을 붙여 스냅샷을 만든다. stat 실패 파일은 키에 `?` 로 남아 항상 미스가 된다. */
export async function snapshot(base: string, files: MdFile[]): Promise<Snapshot> {
  const stats = new Map<string, { mtimeMs: number; size: number }>();
  const now = Date.now();
  let storable = true;
  const parts: string[] = [path.resolve(base)];
  const got = await Promise.all(
    files.map(async (f) => {
      try {
        const st = await fs.stat(f.path);
        return { mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        return null;
      }
    }),
  );
  files.forEach((f, i) => {
    const st = got[i];
    if (!st) {
      storable = false;
      parts.push(`${f.path}\u0000?`);
      return;
    }
    stats.set(f.path, st);
    if (now - st.mtimeMs < FRESH_WINDOW_MS) storable = false; // 규칙 4
    parts.push(`${f.path}\u0000${st.mtimeMs}\u0000${st.size}`);
  });
  return { key: parts.join(""), storable, stats };
}

interface TextEntry {
  mtimeMs: number;
  size: number;
  text: string;
}

interface RootCache {
  base: string; // 절대 경로 — 다르면 통째 폐기(P4-04 `--root` 변경)
  key: string | null; // 마지막으로 저장한 스냅샷 키
  graph: Graph | null;
  texts: Map<string, TextEntry>;
}

let cur: RootCache | null = null;
let derivedBytes = 0;
const derivedStore = new WeakMap<Node, Map<string, unknown>>();

function rootCache(base: string): RootCache {
  const abs = path.resolve(base);
  if (!cur || cur.base !== abs) {
    cur = { base: abs, key: null, graph: null, texts: new Map() };
    derivedBytes = 0;
  }
  return cur;
}

/** 테스트·디버그용 초기화. 프로세스 안에서만 사는 캐시이므로 파일에는 흔적이 없다. */
export function resetCache(): void {
  cur = null;
  derivedBytes = 0;
}

export interface CacheStats {
  root: string | null;
  cachedFiles: number;
  hasGraph: boolean;
  derivedBytes: number;
}

export function cacheStats(): CacheStats {
  return { root: cur?.base ?? null, cachedFiles: cur?.texts.size ?? 0, hasGraph: Boolean(cur?.graph), derivedBytes };
}

/** 스냅샷이 저장된 것과 같으면 캐시된 그래프를 돌려준다(캐시 off 면 항상 null). */
export function getGraph(base: string, snap: Snapshot): Graph | null {
  if (!cacheEnabled()) return null;
  const c = rootCache(base);
  return c.key !== null && c.key === snap.key ? c.graph : null;
}

export function setGraph(base: string, snap: Snapshot, graph: Graph): void {
  if (!cacheEnabled() || !snap.storable) return;
  const c = rootCache(base);
  c.key = snap.key;
  c.graph = graph;
}

/**
 * 파일 텍스트를 읽되 **스냅샷이 같은 파일은 재사용**한다(P4-03). 누적 바이트 예산은 재사용분까지
 * 포함해 그대로 적용한다 — 캐시 유무로 상한 판정이 달라지면 안 된다.
 */
export async function readTexts(base: string, files: MdFile[], snap: Snapshot, concurrency = 32): Promise<string[]> {
  const on = cacheEnabled();
  const c = on ? rootCache(base) : null;
  const texts = new Array<string>(files.length);
  const missing: number[] = [];
  files.forEach((f, i) => {
    const st = snap.stats.get(f.path);
    const hit = c && st ? c.texts.get(f.path) : undefined;
    if (hit && st && hit.mtimeMs === st.mtimeMs && hit.size === st.size) texts[i] = hit.text;
    else missing.push(i);
  });

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const k = next++;
      if (k >= missing.length) return;
      const i = missing[k];
      texts[i] = await read(files[i].path);
    }
  }
  const n = Math.min(concurrency, Math.max(1, missing.length));
  await Promise.all(Array.from({ length: n }, worker));

  // 누적 예산은 캐시 적중분 포함(vault.readAll 과 같은 판정).
  let total = 0;
  for (const t of texts) {
    total += Buffer.byteLength(t, "utf8");
    if (total > MAX_TOTAL_BYTES) throw new VaultLimitError(`vault text exceeds ${MAX_TOTAL_BYTES} bytes in total`);
  }

  if (c && snap.storable) {
    const fresh = new Map<string, TextEntry>();
    files.forEach((f, i) => {
      const st = snap.stats.get(f.path);
      if (st) fresh.set(f.path, { mtimeMs: st.mtimeMs, size: st.size, text: texts[i] });
    });
    c.texts = fresh; // 삭제된 파일은 이 대입으로 사라진다(P4-04)
  } else if (c) {
    c.texts = new Map();
    c.key = null;
    c.graph = null;
  }
  return texts;
}

/**
 * term 과 무관한 노드 파생값(lex haystack·scoreText·dl)을 노드 수명 동안 기억한다(P4-13+).
 * 캐시가 꺼져 있으면 계산만 하고 저장하지 않는다.
 */
export function derived<T>(node: Node, kind: string, compute: () => T): T {
  if (!cacheEnabled()) return compute();
  let slot = derivedStore.get(node);
  if (slot) {
    const v = slot.get(kind);
    if (v !== undefined) return v as T;
  }
  const value = compute();
  if (derivedBytes >= DERIVED_BUDGET_BYTES) return value; // 상한 초과 — 저장하지 않는다
  if (typeof value === "string") derivedBytes += Buffer.byteLength(value, "utf8");
  if (!slot) {
    slot = new Map<string, unknown>();
    derivedStore.set(node, slot);
  }
  slot.set(kind, value);
  return value;
}
