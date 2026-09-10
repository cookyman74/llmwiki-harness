/**
 * cache.ts — 프로세스 내 mtime 캐시 (P4-02~P4-06, P4-13+, 외부리뷰 1·2차 반영).
 *
 * 서버는 장수 프로세스인데 호출마다 볼트를 통째로 다시 읽고 그래프를 다시 만든다. 여기서
 * **파일 스냅샷이 같으면** 그 결과를 재사용한다. 규칙은 정확성 우선이다:
 *
 *  1. 순회(`walkMd`)와 경계 검사는 **호출마다 그대로 수행**한다. 캐시는 순회 결과 뒤에 붙으므로
 *     심볼릭 링크 스킵·realpath 경계(P2-17)를 우회할 수 없다(P4-10).
 *  2. 캐시 키는 볼트 realpath + 파일별 `(경로, dev, ino, mode, size, mtimeNs, ctimeNs)` 다(P4-02).
 *     `lstat` 으로 얻으므로 링크를 따라가지 않는다. **ctime 이 핵심**이다 — Node 의 `ctime` 은 상태
 *     변경 시각(Change Time)이라 내용·권한·이름이 바뀌면 커널이 올리고 userland 가 되돌릴 수 없다.
 *     그래서 `cp -p`·`rsync --times`·`touch -t` 로 mtime·size 를 복원해도 적중하지 않는다(codex 1차
 *     BLOCKER-1). Windows NTFS 도 ChangeTime 을 준다(생성 시각은 `birthtime` — 2차 리뷰가 인용한 "Windows
 *     ctime = 생성 시각" 은 이 파일의 옛 주석 오류였다). **FAT/exFAT·일부 네트워크 FS** 는 변경 시각이
 *     없거나 약해 이 방어가 성립하지 않는다 — README 한계에 기재하고 `LLMWIKI_CACHE=0` 을 권한다.
 *     dev·ino·mode 가 들어가므로 파일이 다른 파일·심볼릭 링크로 교체돼도 미스다(codex 1차 BLOCKER-2).
 *  3. 스냅샷이 다르면 **바뀐 파일만 다시 읽고**, 그래프(정규화·인링크)는 통째로 다시 만든다(P4-03).
 *  4. `mtime` 이 `[-FUTURE_SKEW_MS, FRESH_WINDOW_MS)` 안인 파일이 있으면 그 스냅샷은 '불안정'이다.
 *     불안정한 스냅샷은 **저장하지 않을 뿐 아니라 기존 캐시도 쓰지 않는다** — 그래프 적중도, 파일별
 *     텍스트 재사용도 금지하고 전량 다시 읽는다(codex 2차 BLOCKER-1: 저장만 막고 적중은 허용하던 구멍).
 *     더 미래인 mtime 은 시계 차이로 보고 막지 않는다(agy 1차 BLOCKER-1: 막으면 캐시가 영구 무력화).
 *  5. `LLMWIKI_CACHE=0` 이면 전 경로가 꺼진다(P4-05). 패리티·디버그용.
 *
 * 파생값(P4-13+): lex haystack·bm25 `scoreText`·`dl` 은 **term 과 무관**해서 호출 사이에 재사용할 수
 * 있다. **저장된 그래프의 노드**에만 WeakMap 으로 매단다(그래프 세대 번호로 확인). 예산은 살아 있는
 * 모든 root 의 합으로 계산하고, 그래프가 교체되거나 root 가 축출되면 그 몫이 빠진다(agy 1차 BLOCKER-2,
 * codex 2차 MAJOR-1: 전역 카운터를 새 그래프마다 리셋하면 root 여러 개의 합이 상한을 넘을 수 있었다).
 *
 * 메모리: 텍스트 예산을 넘는 스냅샷은 **그래프도 저장하지 않는다**(그래프가 본문 문자열을 쥐고 있어 텍스트
 * 상한을 우회하던 구멍 — codex 2차 MAJOR-1). root 는 최대 `MAX_ROOTS` 개, LRU. 디스크 캐시는 없다.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Graph, Node } from "./graph.js";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, VaultLimitError, read, type MdFile } from "./vault.js";

/** 파일시스템 타임스탬프 해상도 안(2s)에 수정된 파일이 있으면 스냅샷을 신뢰하지 않는다. */
export const FRESH_WINDOW_MS = 2000;
/** mtime 이 현재보다 이만큼 이상 앞서면 '방금 수정'이 아니라 **시계 차이**로 본다(다른 머신에서 동기·NTP 보정).
 *  `Date.now()` 는 ms 로 잘리고 mtime 은 ns 라 갓 쓴 파일도 1ms 정도 미래로 보일 수 있어, 작은 음수 나이는
 *  여전히 '방금 수정'으로 취급해야 한다. */
export const FUTURE_SKEW_MS = 5000;
/** 파생 문자열(haystack·scoreText) 메모 총량 상한 — 살아 있는 전 root 의 합. */
export const DERIVED_BUDGET_BYTES = 128 * 1024 * 1024;
/** root 하나의 텍스트 보유량 상한. 넘으면 그 스냅샷은 텍스트도 그래프도 저장하지 않는다. */
export const TEXT_BUDGET_BYTES = 256 * 1024 * 1024;
/** 동시에 유지하는 볼트(root) 수 — LRU 로 축출. */
export const MAX_ROOTS = 4;
/** 전 root 텍스트 보유량 합의 상한 — 넘으면 가장 오래 안 쓴 다른 root 부터 비운다(codex 3차 MAJOR-2).
 *  모든 상한은 **문자열 payload 기준의 논리 상한**이지 프로세스 RSS 상한이 아니다(객체 오버헤드 제외). */
export const TOTAL_TEXT_BUDGET_BYTES = 512 * 1024 * 1024;
/** 스냅샷의 lstat 동시성 — 대형 볼트에서 libuv 스레드풀·메모리 버스트를 막는다(agy 3차 MINOR-1). */
export const SNAPSHOT_CONCURRENCY = 64;

let textBudget = TEXT_BUDGET_BYTES;
let totalTextBudget = TOTAL_TEXT_BUDGET_BYTES;
let derivedBudget = DERIVED_BUDGET_BYTES;
let maxTotal = MAX_TOTAL_BYTES;

/** 테스트 전용: 예산을 작게 바꿔 상한 경로를 재현한다. `null` 이면 기본값 복원. */
export function setCacheBudgetsForTest(b: { text?: number; totalText?: number; derived?: number; maxTotal?: number } | null): void {
  textBudget = b?.text ?? TEXT_BUDGET_BYTES;
  totalTextBudget = b?.totalText ?? TOTAL_TEXT_BUDGET_BYTES;
  derivedBudget = b?.derived ?? DERIVED_BUDGET_BYTES;
  maxTotal = b?.maxTotal ?? MAX_TOTAL_BYTES;
}

export function cacheEnabled(): boolean {
  return process.env.LLMWIKI_CACHE !== "0";
}

/** 파일 하나의 신원 — 하나라도 다르면 그 파일은 다시 읽는다. 큰 수는 문자열로 담아 정밀도를 잃지 않는다. */
export interface FileId {
  dev: string;
  ino: string;
  mode: number;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
}

export interface Snapshot {
  /** 볼트 realpath + 파일별 신원. 하나라도 다르면 캐시 미스. */
  key: string;
  /** false 면 '불안정' — 저장하지 않고 기존 캐시도 쓰지 않는다(규칙 4). 텍스트 예산 초과 시 readTexts 가 내린다. */
  storable: boolean;
  /** 파일별 신원 — 바뀐 파일만 다시 읽을 때 쓴다. */
  stats: Map<string, FileId>;
}

function sameFile(a: FileId, b: FileId): boolean {
  return (
    a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
  );
}

const SEP = " ";

/**
 * 순회 결과에 `lstat` 을 붙여 스냅샷을 만든다. 볼트 자체의 realpath 도 키에 넣는다(같은 경로가 다른
 * 실체를 가리키게 바뀌는 경우). stat 실패·비정규 파일은 키에 `?` 로 남아 **항상 미스**가 된다.
 */
export async function snapshot(base: string, files: MdFile[]): Promise<Snapshot> {
  const stats = new Map<string, FileId>();
  const now = Date.now();
  let storable = true;
  let baseKey: string;
  try {
    baseKey = await fs.realpath(base);
  } catch {
    baseKey = path.resolve(base);
    storable = false;
  }
  const parts: string[] = [baseKey];
  const statOne = async (f: MdFile): Promise<FileId | null> => {
    try {
      // lstat: 링크를 따라가지 않는다 — 파일이 링크로 바뀌면 mode·ino 가 달라져 미스가 된다.
      const st = await fs.lstat(f.path, { bigint: true });
      if (!st.isFile()) return null;
      return {
        dev: st.dev.toString(),
        ino: st.ino.toString(),
        mode: Number(st.mode),
        size: Number(st.size),
        mtimeNs: st.mtimeNs.toString(),
        ctimeNs: st.ctimeNs.toString(), // 상태 변경 시각 — userland 가 되돌릴 수 없다
      };
    } catch {
      return null;
    }
  };
  // 동시성 풀(순서는 인덱스로 보존) — 파일 수만큼 lstat 을 한꺼번에 던지지 않는다.
  const got = new Array<FileId | null>(files.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      got[i] = await statOne(files[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, Math.max(1, files.length)) }, worker));
  files.forEach((f, i) => {
    const st = got[i];
    if (!st) {
      storable = false;
      parts.push(`${f.path}${SEP}?`);
      return;
    }
    stats.set(f.path, st);
    const ageMs = now - Number(st.mtimeNs) / 1e6;
    if (ageMs < FRESH_WINDOW_MS && ageMs > -FUTURE_SKEW_MS) storable = false; // 규칙 4
    parts.push([f.path, st.dev, st.ino, st.mode, st.size, st.mtimeNs, st.ctimeNs].join(SEP));
  });
  return { key: parts.join(SEP), storable, stats };
}

interface TextEntry {
  id: FileId;
  text: string;
}

interface RootCache {
  base: string; // 절대 경로 — root 별로 하나씩(최대 MAX_ROOTS, LRU)
  key: string | null; // 마지막으로 저장한 스냅샷 키
  graph: Graph | null;
  gen: number; // 그래프 세대 — 파생 메모가 '지금 저장된 그래프의 노드'인지 확인하는 데 쓴다
  texts: Map<string, TextEntry>;
  textBytes: number;
  derivedBytes: number; // 이 root 의 현재 그래프에 매단 파생값 크기
}

const roots = new Map<string, RootCache>();
const nodeOwner = new WeakMap<Node, { root: RootCache; gen: number }>();
const derivedStore = new WeakMap<Node, Map<string, unknown>>();

/** root 캐시를 꺼내며 LRU 순서를 갱신한다(리뷰 MINOR: 삽입 순서 FIFO 는 자주 쓰는 root 를 먼저 버렸다). */
function rootCache(base: string): RootCache {
  const abs = path.resolve(base);
  let c = roots.get(abs);
  if (c) {
    roots.delete(abs);
    roots.set(abs, c);
    return c;
  }
  c = { base: abs, key: null, graph: null, gen: 0, texts: new Map(), textBytes: 0, derivedBytes: 0 };
  roots.set(abs, c);
  while (roots.size > MAX_ROOTS) evict(roots.keys().next().value as string);
  return c;
}

/** root 를 비우고 제거한다 — 그래프·텍스트 참조를 명시적으로 끊어 GC 가 바로 회수하게(agy 3차 MINOR-2). */
function evict(key: string): void {
  const c = roots.get(key);
  if (c) {
    c.graph = null;
    c.key = null;
    c.texts = new Map();
    c.textBytes = 0;
    c.derivedBytes = 0;
  }
  roots.delete(key);
}

function totalText(): number {
  let n = 0;
  for (const r of roots.values()) n += r.textBytes;
  return n;
}

function totalDerived(): number {
  let n = 0;
  for (const r of roots.values()) n += r.derivedBytes;
  return n;
}

/** 테스트·디버그용 초기화. 프로세스 안에서만 사는 캐시이므로 파일에는 흔적이 없다. */
export function resetCache(): void {
  roots.clear();
}

export interface CacheStats {
  root: string | null;
  cachedFiles: number;
  hasGraph: boolean;
  derivedBytes: number; // 살아 있는 전 root 의 합
  roots: number;
}

/** `base` 를 주면 그 볼트의 상태(없으면 root=null), 생략하면 가장 최근에 쓴 볼트의 상태. LRU 순서는 바꾸지 않는다. */
export function cacheStats(base?: string): CacheStats {
  const c = base ? roots.get(path.resolve(base)) : [...roots.values()].pop();
  return { root: c?.base ?? null, cachedFiles: c?.texts.size ?? 0, hasGraph: Boolean(c?.graph), derivedBytes: totalDerived(), roots: roots.size };
}

/** 스냅샷이 저장된 것과 같고 **안정적일 때만** 캐시된 그래프를 돌려준다(캐시 off 면 항상 null). */
export function getGraph(base: string, snap: Snapshot): Graph | null {
  if (!cacheEnabled() || !snap.storable) return null; // 불안정 스냅샷은 적중 금지(codex 2차 BLOCKER-1)
  const c = rootCache(base);
  return c.key !== null && c.key === snap.key ? c.graph : null;
}

/** 안정적인 스냅샷의 그래프를 저장하고, 그 노드들을 이 root 의 새 세대로 등록한다(파생 예산 리셋). */
export function setGraph(base: string, snap: Snapshot, graph: Graph): void {
  if (!cacheEnabled() || !snap.storable) return;
  const c = rootCache(base);
  c.key = snap.key;
  c.graph = graph;
  c.gen += 1;
  c.derivedBytes = 0; // 옛 그래프의 파생값은 옛 노드와 함께 GC 된다
  const owner = { root: c, gen: c.gen };
  for (const n of graph.nodes.values()) nodeOwner.set(n, owner);
}

/**
 * 파일 텍스트를 읽되 **안정적인 스냅샷에서, 신원이 같은 파일만** 재사용한다(P4-03). 누적 바이트 예산은
 * 재사용분까지 포함해 그대로 적용한다 — 캐시 유무로 상한 판정이 달라지면 안 된다.
 * 텍스트 예산을 넘으면 `snap.storable` 을 내려 그래프도 저장되지 않게 한다.
 */
export async function readTexts(base: string, files: MdFile[], snap: Snapshot, concurrency = 32): Promise<string[]> {
  const c = cacheEnabled() ? rootCache(base) : null;
  const reuse = c !== null && snap.storable; // 불안정 스냅샷이면 전량 재독(codex 2차 BLOCKER-1)
  const texts = new Array<string>(files.length);
  const missing: number[] = [];

  // 누적 예산은 캐시 적중분까지 **읽는 즉시** 센다 — 전부 읽은 뒤 검사하면 상한을 크게 넘는 볼트도
  // 한때 전량 메모리에 올라온다(codex 3차 MAJOR-1). vault.readAll 과 같은 판정·같은 시점.
  let total = 0;
  let failed = false;
  const account = (t: string): void => {
    total += Buffer.byteLength(t, "utf8");
    if (total > maxTotal) {
      failed = true;
      throw new VaultLimitError(`vault text exceeds ${maxTotal} bytes in total`);
    }
  };

  files.forEach((f, i) => {
    const st = snap.stats.get(f.path);
    const hit = reuse && st ? c.texts.get(f.path) : undefined;
    // size 는 신원에 포함되므로 적중 텍스트는 read() 의 MAX_FILE_BYTES 검사를 같은 크기로 통과한 것이다.
    // 그래도 상한 판정을 캐시에 기대지 않도록 크기를 한 번 더 확인한다.
    if (hit && st && st.size <= MAX_FILE_BYTES && sameFile(hit.id, st)) {
      account(hit.text);
      texts[i] = hit.text;
    } else missing.push(i);
  });

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      if (failed) return; // 한 워커가 상한에 걸리면 나머지는 새 파일을 읽지 않는다
      const k = next++;
      if (k >= missing.length) return;
      const i = missing[k];
      const t = await read(files[i].path); // O_NOFOLLOW·파일별 크기 상한은 여기서 그대로 적용된다
      account(t);
      texts[i] = t;
    }
  }
  const n = Math.min(concurrency, Math.max(1, missing.length));
  await Promise.all(Array.from({ length: n }, worker));

  if (total > textBudget) snap.storable = false; // 그래프도 저장하지 않게(그래프가 본문을 쥐고 있다)
  if (c && snap.storable) {
    const fresh = new Map<string, TextEntry>();
    files.forEach((f, i) => {
      const st = snap.stats.get(f.path);
      if (st) fresh.set(f.path, { id: st, text: texts[i] });
    });
    c.texts = fresh; // 삭제된 파일은 이 대입으로 사라진다(P4-04)
    c.textBytes = total;
    // 전 root 합이 상한을 넘으면 가장 오래 안 쓴 **다른** root 부터 비운다(LRU 순서 = Map 순서).
    for (const key of [...roots.keys()]) {
      if (totalText() <= totalTextBudget) break;
      if (key !== c.base) evict(key);
    }
    if (totalText() > totalTextBudget) snap.storable = false; // 혼자서도 넘으면 이 스냅샷은 저장하지 않는다
  }
  if (c && !snap.storable) {
    c.texts = new Map();
    c.textBytes = 0;
    c.key = null;
    c.graph = null;
    c.derivedBytes = 0;
  }
  return texts;
}

/**
 * term 과 무관한 노드 파생값(lex haystack·scoreText·dl)을 **저장된 그래프의 노드**에만 기억한다(P4-13+).
 * 캐시가 꺼져 있거나, 노드가 저장되지 않은(호출 1회용) 그래프 소속이면 계산만 한다.
 */
export function derived<T>(node: Node, kind: string, compute: () => T): T {
  if (!cacheEnabled()) return compute();
  const slot = derivedStore.get(node);
  if (slot?.has(kind)) return slot.get(kind) as T; // has(): undefined 를 저장해도 재계산하지 않는다
  const value = compute();
  const owner = nodeOwner.get(node);
  // 지금 저장된 그래프의 노드인가 — root 가 축출됐거나 그래프가 교체됐으면 저장하지 않는다.
  if (!owner || roots.get(owner.root.base) !== owner.root || owner.root.gen !== owner.gen) return value;
  // 값을 넣기 **전에** 전 root 합으로 예산을 확인한다(codex 1차 MAJOR-4, 2차 MAJOR-1).
  const cost = typeof value === "string" ? Buffer.byteLength(value, "utf8") : 8;
  if (totalDerived() + cost > derivedBudget) return value;
  owner.root.derivedBytes += cost;
  const target = slot ?? new Map<string, unknown>();
  if (!slot) derivedStore.set(node, target);
  target.set(kind, value);
  return value;
}
