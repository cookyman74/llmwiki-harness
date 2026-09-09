# P1 — 리트리벌 포팅: search · expand · rerank · pack + 단위 + 패리티 CI

```
status: review             # not-started | in-progress | review | done
started: 2026-09-09
completed:
external_review: pending   # pending | done → review/P1-agy-YYYY-MM-DD.md
branch: feat/mcp-p1-port (base: feat/mcp-p0-prepare, PR #19 위에 스택)
```

- 근거: `../DESIGN.md §4`(대응표 #1~#21, #17b), `§7`(패리티), `../PRD.md §2 ①, §3`
- 선행 조건: **P0 done** (픽스처·골든셋·스캐폴딩 존재)
- 원칙: Python이 정본. **랭킹 규칙을 고치지 않는다.** 불일치가 나면 TS를 고친다. Python을 고쳐야 한다고 판단되면 작업을 멈추고 사용자 승인을 받는다.
- 완료 표시 방법: `00-README.md` 규칙. 대응표 항목은 ID를 `#n` 으로 함께 적는다.

## 체크리스트

### A. 공통 파서 `src/vault.ts` (대응표 #1~#6)
- [x] P1-01 `walkMd(base)` — `readdir({withFileTypes})`, **디렉터리·파일 이름 정렬(코드포인트)** 순회, `.md` 만, `(path, slug)` 반환. 심볼릭 링크 엔트리 스킵(§5 — P2에서 realpath 검증 추가) `#1` ✅ 2026-09-09 — vault.ts walkMd(readdir withFileTypes, 파일→하위디렉터리 재귀, cmpCodePoint 정렬, symlink 스킵)
- [x] P1-02 `read(path)` — UTF-8 디코드, 선행 BOM 제거, 잘못된 바이트 U+FFFD, **`\r\n`→`\n` 후 잔여 `\r`→`\n`** `#2` ✅ 2026-09-09 — vault.ts decodeText/read (TextDecoder non-fatal, BOM, \r\n·\r→\n)
- [x] P1-03 `frontmatter(text)` — 첫 줄 `---`, 이후 200줄 내 닫는 `---`, 없으면 `""` `#3` ✅ 2026-09-09 — vault.ts frontmatter (lines[1:201])
- [x] P1-04 `field(fm, name)` — `^name:\s*(.+)$` (m 플래그), trim `#4` ✅ 2026-09-09 — vault.ts field (`[^\n]+`, PY_WS_CLASS, pyStrip)
- [x] P1-05 `type` 기본값 = 부모 디렉터리명 `#5` ✅ 2026-09-09 — graph.ts/search.ts dirname 기본값 (pack 은 `?` — P1-42b)
- [x] P1-06 aliases 파싱 — `stripChars(s, "[] ")` 후 `[^\[\],]+` 전부, 각 항목 trim + 양끝 `'"` 제거 `#6` ✅ 2026-09-09 — vault.ts parseAliases (stripChars 문자집합·`[^\[\],]+`·따옴표 제거)
- [x] P1-07 헬퍼 `countSub(hay, needle)` — 비중첩 `indexOf` 루프, 빈 needle 은 0 `#10` ✅ 2026-09-09 — vault.ts countSub (indexOf 루프, 빈 needle 0)
- [x] P1-08 헬퍼 `cmpCodePoint(a, b)` — `codePointAt` 순회 비교 `#11` ✅ 2026-09-09 — vault.ts cmpCodePoint
- [x] P1-09 헬퍼 `splitN(text, sep, n)` — Python `split(sep, maxsplit)` 재현 `#19` ✅ 2026-09-09 — vault.ts splitN
- [x] P1-10 헬퍼 `fmt1(x)` — Python `.1f` 재현: `x*10` 이 정확한 `.5` tie면 half-even, 아니면 `toFixed(1)` `#17` ✅ 2026-09-09 — vault.ts fmt1 (tie 판정 후 half-even)

### B. 그래프 `src/graph.ts` (#7, #8)
- [x] P1-11 `LINK = /(?<!!)\[\[([^\]|#]+)/g` — 임베드 제외 `#7` ✅ 2026-09-09 — graph.ts LINK_RE `/(?<!!)\[\[([^\]|#]+)/g`
- [x] P1-12 `buildGraph(base)` — slug→{type, aliases, out, in, text}; `alias2slug` 는 slug 소문자 + aliases 소문자, **먼저 등록한 것이 이김**(setdefault) `#8` ✅ 2026-09-09 — graph.ts buildGraph (nodes Map 대입=마지막 승, alias2slug slug 는 대입·aliases 는 has-check=setdefault)
- [x] P1-13 링크 정규화 — 원문 slug 존재 시 그대로, 아니면 `alias2slug[lower]`, 자기 링크 제외, 인링크 구성 `#8` ✅ 2026-09-09 — graph.ts 정규화·inlinks

### C. 검색 `src/search.ts` (search.py --files)
- [x] P1-14 `filesMode(terms, root, top)` — 본문+aliases 소문자 haystack, distinct/total, `distinct==0` 제외, 정렬 `(-distinct, -total, slug↑cp)`, `top` 상한 `#11` ✅ 2026-09-09 — search.ts filesMode (파일 단위 순회 — 중복 slug 각 행)
- [x] P1-15 미매치 출력 `no matches for: <소문자화 terms>` `#17b` ✅ 2026-09-09 — format.ts renderSearch (소문자화 terms)

### D. 확장 `src/expand.ts`
- [x] P1-16 `lexScore(d, terms)` → `(distinct, total)`; `lexicalSeeds(G, terms, top)` 정렬 `(-distinct, -total, slug)` ✅ 2026-09-09 — expand.ts lexScore/lexicalSeeds
- [x] P1-17 `expand(G, terms, seeds, max)` — cand `[tier, refs]`, seed `[0, 99]`, `bump` tier=min·refs+=1, MoC 소프트 Top-K `MEMBER_K=6` 정렬 `(-lex, m)`, tier1 필터 `lex>0 || refs>=2`, 최종 정렬 `(tier, -lex, -refs, slug)` → `[:max]` `#12 #13 #14` ✅ 2026-09-09 — expand.ts expand (cand [tier,refs], seed [0,99], kept2 우회, 필터, 정렬)
- [x] P1-18 미매치 출력 `no lexical seed for: <원본 대소문자 terms>` `#17b` ✅ 2026-09-09 — format.ts renderNoSeed (원본 terms)

### E. BM25 `src/bm25.ts` (#15, #16, #17)
- [x] P1-19 `scoreText(d)` — `\]\([^)]*\)`→`]`, `https?://\S+`→`""`, lower `#15` ✅ 2026-09-09 — bm25.ts scoreText (PY_WS 기반 `\S`)
- [x] P1-20 `bm25Rank(G, terms, cand)` — terms 중복 제거·길이<2 제외, N=전체, **dl·avgdl 은 코드포인트 수(`[...s].length`)**, idf=`log((N-df+.5)/(df+.5)+1)`, k1=1.5, b=0.75, 정렬 `(-score, slug)` `#16` ✅ 2026-09-09 — bm25.ts bm25Rank (cpLen dl·avgdl, Python 연산 순서 유지)
- [x] P1-21 rerank 출력 행 `tier\t{fmt1(score)}\tslug\ttype` `#17` ✅ 2026-09-09 — format.ts renderRerank (fmt1)

### F. 팩 `src/pack.ts` (#18~#20)
- [x] P1-22 헤더 `## <slug>  [<type> · conf <conf|-> · <status|active>]`, 없는 slug `## <slug>\n(없음)\n` ✅ 2026-09-09 — pack.ts/format.ts renderPack
- [x] P1-23 claims `^-?\s*claim::\s*(.+)$` (gm) — **코드펜스 토글 적용 안 함** `#18` ✅ 2026-09-09 — pack.ts extractClaims (펜스 토글 없음)
- [x] P1-24 요약 — `splitN(text, "---", 2)` 마지막 조각에서 첫 줄 `t[0]` ∉ `#!>|-` 이고 `[` 로 시작하지 않는 것 `#19` ✅ 2026-09-09 — pack.ts extractSummary (splitN 2)
- [x] P1-25 관계 — `-\s*([\p{L}\p{N}_-]+\s*::\s*\[\[[^\]]+\]\].*)$` (u), 코드펜스 토글, `claim` 접두 제외, `- 관계) …` `#20` ✅ 2026-09-09 — pack.ts extractRelations (`[\p{L}\p{N}_-]+` u, 펜스 토글, claim 제외)
- [x] P1-26 slug→path 인덱스는 walk 순서 **마지막 승** `#1` ✅ 2026-09-09 — pack.ts idx Map 대입=마지막 승

### G. 텍스트 렌더러 `src/format.ts` + `--once`
- [x] P1-27 4모드 각각 Python stdout 과 동일한 문자열 생성(마지막 개행 포함, `\n` 고정) ✅ 2026-09-09 — format.ts 4모드. 정확히는 **search·expand·pack 3모드 바이트 동일, rerank 는 행 구조·순서·tier/slug/type 동일 + 점수 ±0.05**(DESIGN §7; codex 2차 리뷰 #4 표현 정정). 픽스처 56/56 통과
- [x] P1-28 `cli.ts --once <search|expand|pack> --root <r> [옵션…]` — 서버 없이 1회 실행, stdout 에 텍스트만 (P2 에서 MCP 도구와 같은 코드 경로 공유하도록 함수 분리) ✅ 2026-09-09 — cli.ts `--once` + once.ts runOnce(P2 도구와 공유할 단일 경로), parseArgs 는 Python main 과 동일 옵션

### H. 단위 테스트 `test/unit/` (대응표 1행 = 최소 1케이스)
- [x] P1-29 `countSub`: `"aaaa","aa"`→2, 빈 needle→0, 한국어 ✅ 2026-09-09 — test/unit/p1-29-count-sub.test.ts
- [x] P1-30 `fmt1`: 0.25→`0.2`, 0.35→`0.3`, 2.45→`2.5`, 0→`0.0`, 음수, 1e-7 ✅ 2026-09-09 — test/unit/p1-30-fmt1.test.ts (고정 10건 + python3 spawn 대조 k/40 루프). **실버그 검출**: `x*10` tie 판정이 0.35·2.45 등에서 거짓 tie → `x*4` 홀수정수 판정으로 수정, 전수 509/509 Python 일치
- [x] P1-31 `cmpCodePoint`: `'🦀'` vs `'￿'` 순서가 Python 과 동일(non-BMP 가 뒤) ✅ 2026-09-09 — test/unit/p1-31-cmp-codepoint.test.ts (JS `<` 역전 문서화 포함)
- [x] P1-32 `read`: BOM 제거, CRLF→LF, 잘못된 바이트 U+FFFD ✅ 2026-09-09 — test/unit/p1-32-decode-text.test.ts. **실버그 검출**: TextDecoder 기본 BOM 제거 뒤 수동 제거로 이중 BOM 파일이 Python 과 갈림 → 수동 제거 삭제
- [x] P1-33 `frontmatter`: 200줄 초과·닫힘 없음·첫 줄 비-`---` ✅ 2026-09-09 — test/unit/p1-33-frontmatter.test.ts (199/200/201줄 경계)
- [x] P1-34 aliases 파싱: `[a, 'b', "c"]`, 빈 문자열, 쉼표 없는 단일 ✅ 2026-09-09 — test/unit/p1-34-parse-aliases.test.ts (+stripChars 문자집합 의미)
- [x] P1-35 `LINK`: `![[img]]` 제외, `[[a|b]]`·`[[a#h]]` 타겟 `a` ✅ 2026-09-09 — test/unit/p1-35-link-re.test.ts (+buildGraph 임베드·자기링크·strip, 임시 볼트)
- [x] P1-36 `splitN("a---b---c---d","---",2)` → `["a","b","c---d"]` ✅ 2026-09-09 — test/unit/p1-36-split-n.test.ts
- [x] P1-37 관계 정규식: 한국어 술어 매치, 코드펜스 내부 제외, `claim::` 제외 ✅ 2026-09-09 — test/unit/p1-37-extract-relations.test.ts (한국어 술어·들여쓰기·펜스·claim/claims_like 제외·ASCII `\w` 함정)
- [x] P1-38 claims: 코드펜스 내부도 포함됨(비대칭 고정) ✅ 2026-09-09 — test/unit/p1-38-extract-claims.test.ts (펜스 포함·`^-?`·`*` 거부)
- [x] P1-39 BM25 dl: 이모지 포함 문자열의 코드포인트 수 ✅ 2026-09-09 — test/unit/p1-39-cplen-bm25.test.ts (2노드 그래프 BM25 를 Python bm25_rank 값과 1e-9 대조)
- [x] P1-40 alias2slug: 먼저 등록한 slug 유지 ✅ 2026-09-09 — test/unit/p1-40-alias-first-wins.test.ts (임시 볼트, walk 순서)
- [x] P1-41 중복 slug: 마지막 승 ✅ 2026-09-09 — test/unit/p1-41-dup-slug.test.ts (graph/pack 마지막 승 vs search 두 행 — Python 비대칭 고정)

### I. 패리티 `tests/parity.py` + CI
- [x] P1-42 `tests/parity.py` — 픽스처 **14**질의 × 4모드(`test/fixtures/queries.json`·`gen-expected.py` 의 명령 정의 재사용): Python 실행 vs `node dist/cli.js --once …` 바이트 비교, 실패 시 unified diff. rerank 모드는 파서 기반(tier·slug·type·순서 정확, score `|Δ|≤0.05`). 프로세스 실행은 `concurrent.futures` 병렬(P0 리뷰: 직렬 56회 ≈7s) ✅ 2026-09-09 — tests/parity.py: gen-expected 명령 정의 importlib 재사용(드리프트 시 exit 2), ThreadPoolExecutor(112 실행 3.8s), 바이트 비교+unified diff, rerank 파서(행수·tier/slug/type/순서 정확·|Δ|≤0.05), GOLDEN DRIFT 별도 열. 교란 테스트(+0.04 통과/+0.2·순서교환·pack 추가줄 검출) 확인
- [x] P1-42b `pack.ts` 헤더 type 기본값은 `?` (graph/search 의 dirname 기본값과 **비대칭**, DESIGN §4 #5·픽스처 q14) — 단위 테스트 포함 ✅ 2026-09-09 — test/unit/p1-42b-pack-type-default.test.ts (커밋 픽스처 procedure-no-type: pack `?` / search·graph `L4-procedural`)
- [x] P1-43 `--vault <경로>` 모드 — 실볼트 대표 질의 5개 diff, 볼트 없으면 스킵(exit 0 + 메시지) ✅ 2026-09-09 — `--vault <경로>`: 5질의(내장 또는 --vault-queries JSON), pack slugs 는 Python expand 상위 5 런타임 도출, 없으면 SKIP exit 0, 성공 시 내용 미출력(카운트만)
- [x] P1-44 `.github/workflows/ci.yml` 에 `parity` 잡 추가 — 3-OS 매트릭스, setup-node 20 + setup-python, `npm ci && npm run build && npm test && python tests/parity.py` ✅ 2026-09-09 — ci.yml `parity` 잡(3-OS, fail-fast false): setup-python·setup-node 20(npm cache) → `npm ci` → `npm run check`(lint·typecheck·test·build) → `python tests/parity.py`. smoke 잡 무변경
- [x] P1-45 CI 에 `npm pack --dry-run` 검사 — `dist/`·`README.md` 외 파일 0개, `.md` 는 README 하나 ✅ 2026-09-09 — ci.yml pack 가드(shell: bash + 인라인 python): `npm pack --dry-run --json` 목록이 dist/** 비-.md·README.md·package.json 외면 실패, test/ 포함 시 실패. 로컬 실행 14파일 PACK GUARD OK
- [x] P1-46 픽스처 패리티 **전건 통과** 기록 (`todo/baseline/P1-parity.txt`) ✅ 2026-09-09 — baseline/P1-parity.txt: 14×4=56 parity FAIL 0 · golden DRIFT 0 · PARITY ALL PASS (비-rerank 3모드 바이트 동일, rerank 허용오차 규약 적용)
- [x] P1-47 실볼트 `--vault` 패리티 5질의 통과 기록 (`todo/baseline/P1-parity-vault.txt`) ✅ 2026-09-09 — baseline/P1-parity-vault.txt(로컬 전용, 메타데이터만): 5질의×4모드 20/20(3회 반복 동일). 볼트 wiki .md **309**개(manifest sha 기록), Darwin arm64·node 24.18·py 3.12.2. Node 호출 지연(기동 44ms 포함) median 158ms / p95 219ms / max 286ms — 설계 목표 <1s 충족. (초기 "62ms·≈315페이지" 표기는 재현 근거 부족으로 정정 — 코덱스 리뷰 #4)
- [x] P1-49+ 차등 퍼징 `tests/parity_fuzz.py` — 픽스처 볼트에서 무작위 질의(중복 term·빈 term·대문자·이모지·`--top 0`·`--max 0`·rerank 1~50) Python vs Node 비교(seed 고정). 골든셋 "우연 통과" 사각 보완 ✅ 2026-09-09 — 결과는 P1-51+
- [x] P1-50+ 엣지 수정①: `--top 0` 일 때 Python 은 슬라이스 **전** rows 로 미매치 판정 → 빈 출력. TS renderSearch 에 `matched` 인자 추가(자체 점검에서 발견) ✅ 2026-09-09
- [x] P1-51+ 엣지 수정②(퍼징 seed 7 이 검출): term 이 전부 빈 문자열이면 Python search 는 usage→stderr·exit 2·stdout 빔, TS 는 "no matches" 출력 → `UsageError`(exit 2) 로 일치시킴. 수정 후 퍼징 seed 7 120/120·seed 20260909 300/300 ✅ 2026-09-09
- [x] P1-52+ 인프로세스 골든 테스트 `test/unit/golden.test.ts` — 14질의×4모드를 runOnce 로 실행해 expected/ 와 대조(search/expand/pack 정확, rerank 허용오차). 총 단위 테스트 16파일 152건 통과 ✅ 2026-09-09
- [x] P1-53+ (코덱스 BLOCKER-2) #4 field 명시 테스트 — U+3000 공백·`\s*` 개행 넘김·U+2028·부재 필드 (`test/unit/p1-rows-4-9-12-15-17b-21.test.ts`) ✅ 2026-09-09
- [x] P1-54+ (코덱스 BLOCKER-2) #9 lower 명시 테스트 — 'ÀÉÎ Straße İ 한글 ΣΑΣ ǅ' Python 3.12 실측값. **발견**: Python lower() 도 Final_Sigma 규칙을 적용(σας) → vault.ts 주석의 "차이" 기술 정정 ✅ 2026-09-09
- [x] P1-55+ (코덱스 BLOCKER-2) #12~#14 expand 규칙 명시 테스트 — 미니 볼트(임시 dir 생성)로 seed refs bump(99→100/101)·tier1 필터(lex0&refs1 탈락, refs2 유지)·MoC 멤버 Top-K(6, m6~m8 탈락)·정렬·`--max`·`--top-seed`·`--rerank 2` 를 scope-expand.py stdout 과 문자열 동일 비교 ✅ 2026-09-09
- [x] P1-56+ (코덱스 BLOCKER-2) #15 scoreText 명시 테스트 — 링크 타겟·URL 제거(Python `\S` 가 U+001C 에서 멈춤)·소문자, bm25Rank terms 중복·1글자 제외 ✅ 2026-09-09
- [x] P1-57+ (코덱스 BLOCKER-2) #17b 명시 테스트 — search 소문자화 vs expand 원본 유지, `' '.join(['','X'])` 케이스 ✅ 2026-09-09
- [x] P1-58+ (코덱스 BLOCKER-2) #21 명시 테스트 — 기본값 8/6/15/0 과 명시값 동일 출력, parseArgs·`--files` 무시 ✅ 2026-09-09
- [x] P1-59+ (코덱스 MAJOR-6) CLI 옵션 파싱을 Python `main()` 과 같은 엄격성으로 — 값 없는 옵션·`int()` 실패(`--top 1.5`)는 stderr+exit 1 (`ArgError`, `pyInt`: 공백·부호·밑줄 허용). 실측: Python rc 1 = Node rc 1 ✅ 2026-09-09
- [x] P1-60+ (코덱스 MAJOR-3) rerank 점수 열 NaN 허점 차단 — parity.py `re.fullmatch(r'-?\d+\.\d')`+`math.isfinite`, golden.test.ts 정규식+`Number.isFinite`. `1.25`·`NaN` → error, `1.2` → rows 확인 ✅ 2026-09-09
- [x] P1-61+ (코덱스 MAJOR-4) 실볼트 baseline 을 재현 메타데이터(페이지 수 309·manifest sha·환경 버전·명령·3회 반복·지연 분포)로 재작성, 콘텐츠 미포함. 지연 지표 62ms→median 158ms 로 정정 ✅ 2026-09-09
- [x] P1-63+ (codex 2차 BLOCKER-1) `pyLower` Unicode 버전 고정 — Python 3.12(Unicode 15.0) vs Node 24(ICU 78, Unicode 17.0) 전 코드포인트 실측 diff **55개**(모두 Python 항등, Unicode 16/17 신규 대문자). `scripts/gen-pylower-table.py` 가 `src/pylower-table.ts` 를 생성(`--check` 검증), pyLower 는 오버라이드 문자만 Python 결과로, 나머지는 구간 단위 toLowerCase(Final_Sigma 보존). 테스트 `p1-09-pylower-unicode-version.test.ts` ✅ 2026-09-09
- [x] P1-64+ (agy 2차 MAJOR-2) `tests/parity_fuzz.py` rerank 점수 NaN 허점 — parity.py 와 동일한 `.1f` 형식·isfinite 검증 추가 ✅ 2026-09-09
- [x] P1-65+ (agy 2차 MAJOR-3) CI pack 가드 — `$RUNNER_TEMP` 파일 경로 대신 `npm pack … | python -c` stdin 파이프(Windows Git Bash 경로 변환 의존 제거). 로컬 bash 재현 PACK GUARD OK, YAML 유효 ✅ 2026-09-09
- [x] P1-66+ (agy 2차 MINOR-5) fmt1 k/40 프로퍼티 테스트의 python3 spawn 의존 제거 — Python 실측 201값 정적 테이블 내장, 항상 실행 ✅ 2026-09-09
- [x] P1-67+ (codex 2차 MAJOR-2) `parity.py --vault` 에 Python/Node stdout SHA-256 digest 출력 — 실볼트 3회 반복 digest 동일(`9bcb72a0…`, baseline 기록) ✅ 2026-09-09
- [x] P1-68+ (codex 2차 MINOR-3) walkMd 심볼릭 링크 스킵 회귀 테스트 `p1-01-walkmd-symlink.test.ts` — 파일·디렉터리 링크 제외, buildGraph 에 유출 문자열 미적재. 권한 없으면 사유 남기고 skip ✅ 2026-09-09
- [x] P1-69+ (agy 2차 MINOR-4) bm25Rank cpLen 중복 계산 제거(dl 맵 1회 계산, 출력 무변경 — 패리티·퍼징 재확인) ✅ 2026-09-09
- [x] P1-70+ 단위 테스트 총계 갱신: 19파일 **176건** 통과 ✅ 2026-09-09
- [x] P1-62+ 단위 테스트 총계: 17파일 **170건** 통과 (`npm run check`) ✅ 2026-09-09
- [ ] P1-48 Windows 실행 확인 — CI windows-latest 녹색 (경로 구분자·CRLF 콘솔)

## 산출물
- `src/{vault,graph,search,expand,bm25,pack,format,cli}.ts`, `test/unit/*`, `tests/parity.py`, CI 잡 2개
- 패리티 기록 2건

## 완료 기준 (DoD)
- [x] 대응표 21행 + #17b 각각에 대응하는 **명시적** 단위 테스트 존재·통과 ✅ 2026-09-09 — 17파일 170건. 코덱스 리뷰가 지적한 #4·#9·#12~14·#15·#17b·#21 누락을 P1-53+~58+ 로 보강
- [x] 픽스처 패리티 14×4 전건 통과 ✅ 2026-09-09 — tests/parity.py FAIL 0/56·DRIFT 0/56
- [ ] CI 3-OS 녹색 (P1-48 과 함께 — PR 푸시 후 확인. 코덱스 리뷰 BLOCKER-1: 확인 전 체크 금지)
- [x] 실볼트 5질의 패리티 통과 ✅ 2026-09-09 — `parity.py --vault` 0/20 FAIL (fmt1 수정 후 재확인)
- [x] Python 정본 수정 0건 (P0 결정성 수정 외) ✅ 2026-09-09 — `git diff feat/mcp-p0-prepare -- .claude/skills` 비어 있음
- [ ] 외부리뷰 완료

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/*.ts`(server 제외), `test/unit/*`, `tests/parity.py`, CI diff, 패리티 기록
- 관점: ① 대응표 각 행이 코드에 정확히 구현됐는가 — Python 원본 줄과 대조 ② 패리티 테스트가 "통과하도록 약화"된 곳은 없는가(허용오차 범위·비교 생략) ③ 픽스처가 못 잡는 실볼트 케이스 추정 ④ 성능 — 300페이지 <1s 달성 여부와 병목
- 절차: `00-README.md` 규칙. 프롬프트 `review/P1-prompt.txt`, 결과 `review/P1-agy-YYYY-MM-DD.md` (가능하면 `codex` 교차 리뷰 추가)

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| 1차 codex 2026-09-09 (`review/P1-codex-2026-09-09.md`) — agy 는 네트워크(프로필 조회 타임아웃)로 2회 실패, codex 를 1차 리뷰어로 사용 | | | | |
| 1 | BLOCKER | DoD "CI 3-OS 녹색" 이 P1-48 미확인 상태에서 체크됨 | 수용 | DoD 항목 분리·미체크로 정정, PR CI 후 확인 |
| 2 | BLOCKER | #4·#9·#12~14·#15·#17b·#21 명시 단위 테스트 부재(골든 간접 실행만) | 수용 | P1-53+~58+ 신규 테스트 파일 |
| 3 | MAJOR | rerank 점수 `NaN` 이 허용오차 비교를 통과 | 수용 | P1-60+ parity.py·golden.test.ts |
| 4 | MAJOR | 실볼트 지표(315페이지·62ms) 재현 근거 부족 | 수용 | P1-61+ baseline 재작성(309·median 158ms) |
| 5 | MAJOR | lexScore 중복 계산(Python 도 동일 구조) — 1,000p 성능 우려 | **이월(P4)** — 결과 무변경 최적화지만 P1 은 "정본과 같은 구조" 유지가 패리티 검증에 유리. 현 지연 median 158ms 로 목표(<1s) 충족. P4-cache 에 항목 추가 | P4-12+ |
| 6 | MAJOR | CLI 옵션 파싱이 Python 보다 관대(`--top 1.5`→1, 값 없는 `--root`) | 수용 | P1-59+ |
| 7 | MAJOR | walkMd realpath 경계 검증 미구현(P2 예정) | 수용(이미 P2-17 로 추적) | P2-17 |
| 확인 | — | 리뷰어 샌드박스에서 `npm test` 가 vitest 임시 디렉터리 권한 오류로 실행 불가 → 152건 통과를 독립 재검증 못함 | 참고 — 환경 문제. CI 3-OS 결과가 독립 증거 | P1-48 |
| 2차 agy 2026-09-09 (`review/P1-agy-2026-09-09.md`) · 2차 codex (`review/P1-codex-r2-2026-09-09.md`) — 1차 반영 7건 전부 "동의" 판정 | | | | |
| a1 | BLOCKER | Windows CI 증거(P1-48) 미확보 — PR 전까지 review 유지 | 수용(절차) | PR 푸시 후 CI 확인 → P1-48·DoD 체크 |
| a2 | MAJOR | parity_fuzz.py 의 rerank NaN 허점 잔존 | 수용 | P1-64+ |
| a3 | MAJOR | CI pack 가드 `$RUNNER_TEMP` 경로의 Windows 위험 | 수용 | P1-65+ |
| a4 | MINOR | bm25Rank cpLen 중복 | 수용 | P1-69+ |
| a5 | MINOR | fmt1 프로퍼티 테스트 python3 의존·조용한 skip | 수용 | P1-66+ |
| a6 | MINOR | realpath 경계 검증은 P2 | 수용(P2-17 추적) | P2-17 |
| c1 | BLOCKER | Python 3.12 vs Node ICU Unicode 버전 차이로 lower() 55 코드포인트 상이 → 매치·메시지 바이트 상이 가능 | **수용** — 실측으로 55개 확인, 테이블 고정 | P1-63+ |
| c2 | MAJOR | 실볼트 "3회 반복 동일" 이 출력 동일성을 증명하지 않음 | 수용 | P1-67+ |
| c3 | MINOR | symlink 스킵 회귀 테스트 부재 | 수용 | P1-68+ |
| c4 | MINOR | P1-27/46 "바이트 동일" 표현이 rerank 허용오차와 충돌 | 수용 | P1-27·P1-46 문구 정정 |
| 확인 | — | 두 리뷰어 모두 샌드박스에서 vitest EPERM 으로 `npm test` 미실행(정적 검토) | 참고 — CI 3-OS 가 독립 증거 | P1-48 |

