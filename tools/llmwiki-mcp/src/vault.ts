/**
 * vault.ts — 공통 파서·헬퍼 (DESIGN §2, 대응표 #1~#6, #10, #11, #17, #19).
 *
 * 정본: .claude/skills/wiki-lint/scripts/scope-expand.py, search.py.
 * 여기의 모든 함수는 Python 문자열 API 의미를 **그대로** 재현한다. JS 기본 API 와 다른 지점은
 * 각 함수 주석에 명시한다(추측 금지 — 대응표와 단위 테스트가 근거).
 */
import { promises as fs, constants as fsConstants, type Dirent } from "node:fs";
import path from "node:path";
import { PY_LOWER_OVERRIDES } from "./pylower-table.js";

/** Python `str.isspace()` 가 참인 문자 집합 (str.strip()·`\s` 의 기준). JS `\s` 와 다르다:
 *  JS 는 U+FEFF 를 포함하고 U+001C~U+001F·U+0085 를 포함하지 않는다. */
export const PY_WS_CLASS =
  "\\t\\n\\x0b\\x0c\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_WS_RE_LEAD = new RegExp(`^[${PY_WS_CLASS}]+`);
const PY_WS_RE_TRAIL = new RegExp(`[${PY_WS_CLASS}]+$`);

/** Python `str.strip()` (인자 없음). */
export function pyStrip(s: string): string {
  return s.replace(PY_WS_RE_LEAD, "").replace(PY_WS_RE_TRAIL, "");
}

/** Python `str.strip(chars)` — 양끝에서 `chars` 에 속한 **문자 집합**을 제거(문자열 접두/접미가 아님). #6 */
export function stripChars(s: string, chars: string): string {
  const set = new Set([...chars]);
  const cps = [...s];
  let i = 0;
  let j = cps.length;
  while (i < j && set.has(cps[i])) i++;
  while (j > i && set.has(cps[j - 1])) j--;
  return cps.slice(i, j).join("");
}

/** Python `str.count(sub)` — 비중첩 부분문자열 개수. `split(sub).length-1` 은 빈 sub 예외가 있어 금지. #10
 *  빈 needle 은 Python 이 len+1 을 돌려주지만 호출부(terms 필터)가 빈 term 을 걸러내므로 0 으로 둔다. */
export function countSub(hay: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const k = hay.indexOf(needle, i);
    if (k < 0) return n;
    n++;
    i = k + needle.length;
  }
}

/** Python 문자열 비교(코드포인트 순). JS `<` 는 UTF-16 코드유닛 비교라 non-BMP 에서 역전된다. #11 */
export function cmpCodePoint(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

/** Python `len(str)` — 코드포인트 수(UTF-16 코드유닛 수가 아님). #16 */
export function cpLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++; // 서로게이트 쌍 = 코드포인트 1개
    }
    n++;
  }
  return n;
}

/** Python `str.split(sep, maxsplit)` — 앞에서 maxsplit 번만 분리. #19 */
export function splitN(s: string, sep: string, maxsplit: number): string[] {
  const out: string[] = [];
  let rest = s;
  for (let k = 0; k < maxsplit; k++) {
    const idx = rest.indexOf(sep);
    if (idx < 0) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + sep.length);
  }
  out.push(rest);
  return out;
}

/** Python 3.12 `str.lower()`. JS `toLowerCase()` 와 규칙은 같다(Unicode 전체 소문자화 + Final_Sigma: 'ΣΑΣ'→'σας',
 *  'İ'→'i̇', 'ǅ'→'ǆ' — 실측, 단위테스트 #9) 그러나 **Unicode 버전이 다르다**: Python 3.12 = 15.0, Node 24 ICU 78 = 17.0.
 *  Unicode 16/17 신규 대문자(U+1C89, U+10D50~, U+16EA0~ 등 55개)는 JS 만 소문자화한다(codex P1 2차 리뷰 BLOCKER-1).
 *  `PY_LOWER_OVERRIDES`(자동 생성)에 있는 코드포인트는 Python 결과를 강제한다. 나머지 구간은 toLowerCase 를 **연속 구간
 *  단위**로 적용해 Final_Sigma 문맥을 보존한다. 오버라이드 문자가 없는 문자열(사실상 전부)은 fast path. #9 */
export function pyLower(s: string): string {
  let hasOverride = false;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) as number;
    if (cp > 0xffff) i++;
    if (PY_LOWER_OVERRIDES.has(cp)) {
      hasOverride = true;
      break;
    }
  }
  if (!hasOverride) return s.toLowerCase();
  let out = "";
  let run = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (PY_LOWER_OVERRIDES.has(cp)) {
      out += run.toLowerCase();
      run = "";
      const py = PY_LOWER_OVERRIDES.get(cp);
      out += py === null || py === undefined ? ch : String.fromCodePoint(...py);
    } else {
      run += ch;
    }
  }
  return out + run.toLowerCase();
}

/** Python `f"{x:.1f}"` — 이진값의 정확한 십진 전개를 올바르게 반올림, **정확한 tie 만 half-even**.
 *  JS `toFixed(1)` 도 정확한 값으로 반올림하지만 tie 에서 큰 쪽을 고른다(0.25→"0.3", Python "0.2"). 그 외 값은 두 언어가
 *  같다(0.35 의 이진값은 0.3499…→ 둘 다 "0.3"; 2.45 는 2.4500…018 → 둘 다 "2.5").
 *  .1f 의 정확한 tie 는 x = (2i+1)/4 (0.25, 0.75, 1.25, …) 뿐이다 — odd/20 이 이진 유한소수이려면 분모 5 가 약분돼야 하므로.
 *  판정: `x*4` 는 2의 거듭제곱 곱이라 무손실 → 홀수 정수면 tie. (`x*10` 판정은 0.35*10===3.5 처럼 곱셈 반올림으로 거짓 tie 를
 *  만든다 — P1 단위테스트가 검출, 2026-09-09.) #17 */
export function fmt1(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? "inf" : x < 0 ? "-inf" : "nan";
  const q = x * 4;
  const isTie = Number.isInteger(q) && Math.abs(q % 2) === 1;
  if (!isTie) return x.toFixed(1);
  // x = q/4 정확. x*10 = 2.5*q 도 정확(분모 2). half-even.
  const y = x * 10;
  const lo = Math.floor(y);
  const n = lo % 2 === 0 ? lo : lo + 1;
  const neg = n < 0 || (n === 0 && x < 0);
  const abs = Math.abs(n);
  const s = `${Math.trunc(abs / 10)}.${abs % 10}`;
  return neg ? `-${s}` : s;
}

/** Python `open(path, encoding="utf-8-sig", errors="replace")` 텍스트 모드 read:
 *  BOM 제거 + 잘못된 바이트 U+FFFD + **universal newlines**(`\r\n`·`\r` → `\n`). #2 */
export function decodeText(buf: Uint8Array): string {
  // TextDecoder 기본(ignoreBOM: false)이 선두 BOM **하나**를 제거한다 = Python utf-8-sig 와 동일.
  // 수동으로 한 번 더 지우면 BOM 두 개 파일에서 Python(`'\ufeffx'`)과 갈린다(P1 단위테스트 검출).
  const s = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 볼트 규모 상한(리뷰 MAJOR: 무제한 read). 초과 시 조용히 결과를 바꾸지 않고 **명시적 오류**로 실패(패리티 보존). */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_FILES = 20000;
export const MAX_DIRS = 5000; // codex 2차 #3: 디렉터리 수·깊이·누적 바이트 상한
export const MAX_DEPTH = 32;
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export class VaultLimitError extends Error {}

export async function read(p: string): Promise<string> {
  // TOCTOU 완화(리뷰 BLOCKER): realpath 검사 뒤 파일이 심볼릭 링크로 바뀌어도 O_NOFOLLOW 가 최종 구성요소의 링크를 따라가지 않는다
  // (POSIX 전용 — Windows 는 상수가 없어 0). 잔여 위험(상위 디렉터리 교체 경쟁)은 로컬 단일 사용자 도구 범위에서 수용.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let fh: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    fh = await fs.open(p, flags);
    const st = await fh.stat();
    if (st.size > MAX_FILE_BYTES) throw new VaultLimitError(`file exceeds ${MAX_FILE_BYTES} bytes: ${JSON.stringify(path.basename(p))}`);
    return decodeText(await fh.readFile());
  } catch (e) {
    if (e instanceof VaultLimitError) throw e;
    return ""; // Python read(): OSError → ""  (링크 거부 ELOOP 도 여기로 — 내용 대신 빈 문자열)
  } finally {
    await fh?.close();
  }
}

export interface MdFile {
  path: string;
  slug: string;
}

/** Python `walk_md(base)`: `os.walk` 를 top-down 으로 — 디렉터리의 파일(정렬)을 먼저, 그다음 하위 디렉터리(정렬)로
 *  재귀. 정렬은 코드포인트 순(P0 `dirs.sort()`·`sorted(files)`). 심볼릭 링크 엔트리는 건너뛴다(DESIGN §5 — Python 정본에는
 *  없는 보안 규칙이지만 픽스처에 링크가 없어 패리티 영향 없음). #1 */
export async function walkMd(base: string): Promise<MdFile[]> {
  const out: MdFile[] = [];
  // P2-17: 경계 검증 — 각 .md 의 realpath 가 base 의 realpath 하위인지 path.relative 로 판정(문자열 startsWith 금지).
  // 심볼릭 링크 엔트리는 아래에서 이미 건너뛰지만, 상위 디렉터리가 링크인 경우 등 우회를 realpath 로 한 번 더 막는다.
  let baseReal: string | null = null;
  try {
    baseReal = await fs.realpath(base);
  } catch {
    baseReal = null; // base 없음 → readdir 실패로 빈 결과
  }
  const inside = async (p: string): Promise<boolean> => {
    if (!baseReal) return false;
    try {
      const rel = path.relative(baseReal, await fs.realpath(p));
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    } catch {
      return false;
    }
  };
  let dirCount = 0;
  async function visit(dir: string, depth = 0): Promise<void> {
    if (depth > MAX_DEPTH) throw new VaultLimitError(`vault directory depth exceeds ${MAX_DEPTH}`);
    if (++dirCount > MAX_DIRS) throw new VaultLimitError(`vault exceeds ${MAX_DIRS} directories`);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files: string[] = [];
    const dirs: string[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) dirs.push(e.name);
      else if (e.isFile()) files.push(e.name);
    }
    files.sort(cmpCodePoint);
    dirs.sort(cmpCodePoint);
    // realpath 경계 검사는 파일별 순차 await 가 1,000 페이지에서 ~30ms 를 차지(P2 perf 측정) → 디렉터리 단위 병렬, 순서는 정렬 목록 기준 유지
    const mds = files.filter((f) => f.endsWith(".md")).map((f) => ({ f, p: path.join(dir, f) }));
    const ok = await Promise.all(mds.map((m) => inside(m.p)));
    mds.forEach((m, i) => {
      if (!ok[i]) {
        // 경로만(내용 금지), JSON.stringify 로 개행·제어문자 이스케이프 → 로그 주입 방지(리뷰)
        process.stderr.write(`[llmwiki] skipped: outside wiki boundary: ${JSON.stringify(path.relative(base, m.p))}\n`);
        return;
      }
      out.push({ path: m.p, slug: m.f.slice(0, -3) });
      if (out.length > MAX_FILES) throw new VaultLimitError(`vault exceeds ${MAX_FILES} markdown files`);
    });
    for (const d of dirs) await visit(path.join(dir, d), depth + 1);
  }
  await visit(base);
  return out;
}

/** Python `frontmatter(text)`: 첫 줄이 `---` 일 때 이후 200줄(lines[1:201]) 안에서 닫는 `---` 까지. 없으면 "". #3 */
export function frontmatter(text: string): string {
  const lines = text.split("\n");
  if (lines.length === 0 || pyStrip(lines[0]) !== "---") return "";
  const out: string[] = [];
  const end = Math.min(lines.length, 201);
  for (let i = 1; i < end; i++) {
    const ln = lines[i];
    if (pyStrip(ln) === "---") return out.join("\n");
    out.push(ln);
  }
  return "";
}

/** Python `field(fm, name)`: `re.search(rf"^{name}:\s*(.+)$", fm, re.MULTILINE)` → group(1).strip(). #4
 *  JS `.` 은 U+2028/2029 도 제외하므로 `[^\n]+` 로 Python `.`(개행만 제외) 을 재현. */
export function field(fm: string, name: string): string {
  const re = new RegExp(`^${name}:[${PY_WS_CLASS}]*([^\\n]+)$`, "m");
  const m = re.exec(fm);
  return m ? pyStrip(m[1]) : "";
}

/** Python aliases 파싱: `re.findall(r"[^\[\],]+", aliases.strip("[] "))` → 각 `strip().strip("'\"")`, 빈 항목 제외. #6 */
export function parseAliases(aliases: string): string[] {
  const inner = stripChars(aliases, "[] ");
  const out: string[] = [];
  for (const m of inner.matchAll(/[^[\],]+/g)) {
    const a = stripChars(pyStrip(m[0]), "'\"");
    if (a) out.push(a);
  }
  return out;
}

/** 파일 목록을 순서 보존하며 동시성 제한으로 읽는다(DESIGN §6). */
export async function readAll(files: MdFile[], concurrency = 32): Promise<string[]> {
  const texts = new Array<string>(files.length);
  let next = 0;
  let total = 0; // 누적 바이트 예산(codex 2차 #3) — 초과 시 명시적 오류
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const t = await read(files[i].path);
      total += Buffer.byteLength(t, "utf8");
      if (total > MAX_TOTAL_BYTES) throw new VaultLimitError(`vault text exceeds ${MAX_TOTAL_BYTES} bytes in total`);
      texts[i] = t;
    }
  }
  const n = Math.min(concurrency, Math.max(1, files.length));
  await Promise.all(Array.from({ length: n }, worker));
  return texts;
}
