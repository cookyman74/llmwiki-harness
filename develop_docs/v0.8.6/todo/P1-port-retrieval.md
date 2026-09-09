# P1 — 리트리벌 포팅: search · expand · rerank · pack + 단위 + 패리티 CI

```
status: not-started        # not-started | in-progress | review | done
started:
completed:
external_review:           # pending | done → review/P1-agy-YYYY-MM-DD.md
```

- 근거: `../DESIGN.md §4`(대응표 #1~#21, #17b), `§7`(패리티), `../PRD.md §2 ①, §3`
- 선행 조건: **P0 done** (픽스처·골든셋·스캐폴딩 존재)
- 원칙: Python이 정본. **랭킹 규칙을 고치지 않는다.** 불일치가 나면 TS를 고친다. Python을 고쳐야 한다고 판단되면 작업을 멈추고 사용자 승인을 받는다.
- 완료 표시 방법: `00-README.md` 규칙. 대응표 항목은 ID를 `#n` 으로 함께 적는다.

## 체크리스트

### A. 공통 파서 `src/vault.ts` (대응표 #1~#6)
- [ ] P1-01 `walkMd(base)` — `readdir({withFileTypes})`, **디렉터리·파일 이름 정렬(코드포인트)** 순회, `.md` 만, `(path, slug)` 반환. 심볼릭 링크 엔트리 스킵(§5 — P2에서 realpath 검증 추가) `#1`
- [ ] P1-02 `read(path)` — UTF-8 디코드, 선행 BOM 제거, 잘못된 바이트 U+FFFD, **`\r\n`→`\n` 후 잔여 `\r`→`\n`** `#2`
- [ ] P1-03 `frontmatter(text)` — 첫 줄 `---`, 이후 200줄 내 닫는 `---`, 없으면 `""` `#3`
- [ ] P1-04 `field(fm, name)` — `^name:\s*(.+)$` (m 플래그), trim `#4`
- [ ] P1-05 `type` 기본값 = 부모 디렉터리명 `#5`
- [ ] P1-06 aliases 파싱 — `stripChars(s, "[] ")` 후 `[^\[\],]+` 전부, 각 항목 trim + 양끝 `'"` 제거 `#6`
- [ ] P1-07 헬퍼 `countSub(hay, needle)` — 비중첩 `indexOf` 루프, 빈 needle 은 0 `#10`
- [ ] P1-08 헬퍼 `cmpCodePoint(a, b)` — `codePointAt` 순회 비교 `#11`
- [ ] P1-09 헬퍼 `splitN(text, sep, n)` — Python `split(sep, maxsplit)` 재현 `#19`
- [ ] P1-10 헬퍼 `fmt1(x)` — Python `.1f` 재현: `x*10` 이 정확한 `.5` tie면 half-even, 아니면 `toFixed(1)` `#17`

### B. 그래프 `src/graph.ts` (#7, #8)
- [ ] P1-11 `LINK = /(?<!!)\[\[([^\]|#]+)/g` — 임베드 제외 `#7`
- [ ] P1-12 `buildGraph(base)` — slug→{type, aliases, out, in, text}; `alias2slug` 는 slug 소문자 + aliases 소문자, **먼저 등록한 것이 이김**(setdefault) `#8`
- [ ] P1-13 링크 정규화 — 원문 slug 존재 시 그대로, 아니면 `alias2slug[lower]`, 자기 링크 제외, 인링크 구성 `#8`

### C. 검색 `src/search.ts` (search.py --files)
- [ ] P1-14 `filesMode(terms, root, top)` — 본문+aliases 소문자 haystack, distinct/total, `distinct==0` 제외, 정렬 `(-distinct, -total, slug↑cp)`, `top` 상한 `#11`
- [ ] P1-15 미매치 출력 `no matches for: <소문자화 terms>` `#17b`

### D. 확장 `src/expand.ts`
- [ ] P1-16 `lexScore(d, terms)` → `(distinct, total)`; `lexicalSeeds(G, terms, top)` 정렬 `(-distinct, -total, slug)`
- [ ] P1-17 `expand(G, terms, seeds, max)` — cand `[tier, refs]`, seed `[0, 99]`, `bump` tier=min·refs+=1, MoC 소프트 Top-K `MEMBER_K=6` 정렬 `(-lex, m)`, tier1 필터 `lex>0 || refs>=2`, 최종 정렬 `(tier, -lex, -refs, slug)` → `[:max]` `#12 #13 #14`
- [ ] P1-18 미매치 출력 `no lexical seed for: <원본 대소문자 terms>` `#17b`

### E. BM25 `src/bm25.ts` (#15, #16, #17)
- [ ] P1-19 `scoreText(d)` — `\]\([^)]*\)`→`]`, `https?://\S+`→`""`, lower `#15`
- [ ] P1-20 `bm25Rank(G, terms, cand)` — terms 중복 제거·길이<2 제외, N=전체, **dl·avgdl 은 코드포인트 수(`[...s].length`)**, idf=`log((N-df+.5)/(df+.5)+1)`, k1=1.5, b=0.75, 정렬 `(-score, slug)` `#16`
- [ ] P1-21 rerank 출력 행 `tier\t{fmt1(score)}\tslug\ttype` `#17`

### F. 팩 `src/pack.ts` (#18~#20)
- [ ] P1-22 헤더 `## <slug>  [<type> · conf <conf|-> · <status|active>]`, 없는 slug `## <slug>\n(없음)\n`
- [ ] P1-23 claims `^-?\s*claim::\s*(.+)$` (gm) — **코드펜스 토글 적용 안 함** `#18`
- [ ] P1-24 요약 — `splitN(text, "---", 2)` 마지막 조각에서 첫 줄 `t[0]` ∉ `#!>|-` 이고 `[` 로 시작하지 않는 것 `#19`
- [ ] P1-25 관계 — `-\s*([\p{L}\p{N}_-]+\s*::\s*\[\[[^\]]+\]\].*)$` (u), 코드펜스 토글, `claim` 접두 제외, `- 관계) …` `#20`
- [ ] P1-26 slug→path 인덱스는 walk 순서 **마지막 승** `#1`

### G. 텍스트 렌더러 `src/format.ts` + `--once`
- [ ] P1-27 4모드 각각 Python stdout 과 동일한 문자열 생성(마지막 개행 포함, `\n` 고정)
- [ ] P1-28 `cli.ts --once <search|expand|pack> --root <r> [옵션…]` — 서버 없이 1회 실행, stdout 에 텍스트만 (P2 에서 MCP 도구와 같은 코드 경로 공유하도록 함수 분리)

### H. 단위 테스트 `test/unit/` (대응표 1행 = 최소 1케이스)
- [ ] P1-29 `countSub`: `"aaaa","aa"`→2, 빈 needle→0, 한국어
- [ ] P1-30 `fmt1`: 0.25→`0.2`, 0.35→`0.3`, 2.45→`2.5`, 0→`0.0`, 음수, 1e-7
- [ ] P1-31 `cmpCodePoint`: `'🦀'` vs `'￿'` 순서가 Python 과 동일(non-BMP 가 뒤)
- [ ] P1-32 `read`: BOM 제거, CRLF→LF, 잘못된 바이트 U+FFFD
- [ ] P1-33 `frontmatter`: 200줄 초과·닫힘 없음·첫 줄 비-`---`
- [ ] P1-34 aliases 파싱: `[a, 'b', "c"]`, 빈 문자열, 쉼표 없는 단일
- [ ] P1-35 `LINK`: `![[img]]` 제외, `[[a|b]]`·`[[a#h]]` 타겟 `a`
- [ ] P1-36 `splitN("a---b---c---d","---",2)` → `["a","b","c---d"]`
- [ ] P1-37 관계 정규식: 한국어 술어 매치, 코드펜스 내부 제외, `claim::` 제외
- [ ] P1-38 claims: 코드펜스 내부도 포함됨(비대칭 고정)
- [ ] P1-39 BM25 dl: 이모지 포함 문자열의 코드포인트 수
- [ ] P1-40 alias2slug: 먼저 등록한 slug 유지
- [ ] P1-41 중복 slug: 마지막 승

### I. 패리티 `tests/parity.py` + CI
- [ ] P1-42 `tests/parity.py` — 픽스처 **14**질의 × 4모드(`test/fixtures/queries.json`·`gen-expected.py` 의 명령 정의 재사용): Python 실행 vs `node dist/cli.js --once …` 바이트 비교, 실패 시 unified diff. rerank 모드는 파서 기반(tier·slug·type·순서 정확, score `|Δ|≤0.05`). 프로세스 실행은 `concurrent.futures` 병렬(P0 리뷰: 직렬 56회 ≈7s)
- [ ] P1-42b `pack.ts` 헤더 type 기본값은 `?` (graph/search 의 dirname 기본값과 **비대칭**, DESIGN §4 #5·픽스처 q14) — 단위 테스트 포함
- [ ] P1-43 `--vault <경로>` 모드 — 실볼트 대표 질의 5개 diff, 볼트 없으면 스킵(exit 0 + 메시지)
- [ ] P1-44 `.github/workflows/ci.yml` 에 `parity` 잡 추가 — 3-OS 매트릭스, setup-node 20 + setup-python, `npm ci && npm run build && npm test && python tests/parity.py`
- [ ] P1-45 CI 에 `npm pack --dry-run` 검사 — `dist/`·`README.md` 외 파일 0개, `.md` 는 README 하나
- [ ] P1-46 픽스처 패리티 **전건 통과** 기록 (`todo/baseline/P1-parity.txt`)
- [ ] P1-47 실볼트 `--vault` 패리티 5질의 통과 기록 (`todo/baseline/P1-parity-vault.txt`)
- [ ] P1-48 Windows 실행 확인 — CI windows-latest 녹색 (경로 구분자·CRLF 콘솔)

## 산출물
- `src/{vault,graph,search,expand,bm25,pack,format,cli}.ts`, `test/unit/*`, `tests/parity.py`, CI 잡 2개
- 패리티 기록 2건

## 완료 기준 (DoD)
- [ ] 대응표 21행 + #17b 각각에 대응하는 단위 테스트 존재·통과
- [ ] 픽스처 패리티 12×4 전건 통과, CI 3-OS 녹색
- [ ] 실볼트 5질의 패리티 통과
- [ ] Python 정본 수정 0건 (P0 결정성 수정 외)
- [ ] 외부리뷰 완료

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/*.ts`(server 제외), `test/unit/*`, `tests/parity.py`, CI diff, 패리티 기록
- 관점: ① 대응표 각 행이 코드에 정확히 구현됐는가 — Python 원본 줄과 대조 ② 패리티 테스트가 "통과하도록 약화"된 곳은 없는가(허용오차 범위·비교 생략) ③ 픽스처가 못 잡는 실볼트 케이스 추정 ④ 성능 — 300페이지 <1s 달성 여부와 병목
- 절차: `00-README.md` 규칙. 프롬프트 `review/P1-prompt.txt`, 결과 `review/P1-agy-YYYY-MM-DD.md` (가능하면 `codex` 교차 리뷰 추가)

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| | | | | |
