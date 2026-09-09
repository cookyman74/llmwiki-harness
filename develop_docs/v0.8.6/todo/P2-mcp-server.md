# P2 — MCP 서버: 도구 4개 · 호환 규칙 · 보안 · CLI 서브커맨드

```
status: not-started        # not-started | in-progress | review | done
started:
completed:
external_review:           # pending | done → review/P2-agy-YYYY-MM-DD.md
```

- 근거: `../DESIGN.md §3`(도구 계약·다중 클라이언트 호환 규칙), `§3.5`(서버 메타·CLI), `§5`(보안), `§6`(성능), `../PRD.md §2 ②③, §5`
- 선행 조건: **P1 done** (리트리벌 함수·`--once` 존재)
- 완료 표시 방법: `00-README.md` 규칙

## 체크리스트

### A. 서버 골격 `src/server.ts`
- [ ] P2-01 `McpServer({name: "llmwiki", version: package.json})`, stdio transport
- [ ] P2-02 `instructions` 3줄 — 읽기 전용 / 라우팅 표(§1) / 신뢰도 병기·stale→superseded_by 추적
- [ ] P2-03 기동 시 `<root>/wiki` 존재 확인, 없으면 stderr 1줄 + exit 2. root 는 `--root` → `LLMWIKI_ROOT` → 오류
- [ ] P2-04 stdout 은 transport 전용 — 진단은 stderr, 기본 quiet, `LLMWIKI_DEBUG=1` 이면 도구별 소요(ms)만(질의어·내용 금지)

### B. 도구 4개 (P1 함수 재사용, `--once` 와 동일 코드 경로)
- [ ] P2-05 `wiki_search` — 입력 `terms[] (1~10, 각 ≤64자)`, `top (1~50, 기본 8)`; 텍스트 + JSON `{rows}`
- [ ] P2-06 `wiki_expand` — `terms[]`, `max (1~50, 15)`, `top_seed (1~20, 6)`, `rerank (0~50, 0)`; JSON `{rows, suggested_next}` — rerank>0→`wiki_pack`, max≤6→`answer`, 그 외→`wiki_read_page`
- [ ] P2-07 `wiki_pack` — `slugs[] (1~30)`; 텍스트(Python 동일) + JSON `{pages:[{slug,type,confidence,status,claims,summary?,relations}]}`
- [ ] P2-08 `wiki_read_page` — `slug`; 검증 `^[\p{L}\p{N}._\- ]{1,120}$`(u), `/`·`\`·`..` 불포함; alias 1회 리다이렉트; 없으면 `isError` `page not found: <slug>`; 200KB 절단 + `truncated: true`; JSON 에 frontmatter 요약(type·confidence·status·superseded_by·last_confirmed)
- [ ] P2-09 모든 도구에 `outputSchema` 선언, `structuredContent` 와 단위 테스트로 일치 확인
- [ ] P2-10 응답 텍스트 상한 200KB, 초과 시 절단 + `truncated: true`

### C. 다중 클라이언트 호환 규칙 (§3 공통)
- [ ] P2-11 입력 정규화는 **핸들러 첫 줄(런타임)** 에서 — `terms` 문자열→공백 분할, slug 양끝 공백·`[[`·`]]`·`.md`·`wiki/…/` 제거. Zod `preprocess/transform/union` 사용 금지
- [ ] P2-12 스키마 부분집합 검사 스크립트 `test/schema-subset.test.ts` — `tools/list` 덤프에서 금지 키워드(`anyOf|oneOf|allOf|\$ref|\$defs|const|default|additionalProperties|format`) 0건
- [ ] P2-13 도구명 `^[a-z][a-z0-9_]{0,63}$` 검사
- [ ] P2-14 description — 영문 먼저 + 한국어 한 줄, 각 ≤500자, 합계 ≤2,000자, **마지막 줄에 그 도구의 라우팅 위치 한 줄**. 길이 테스트 추가
- [ ] P2-15 stdout 순수성 테스트 — 서버 기동 후 첫 바이트가 `{` (JSON-RPC) 인지, `console.log` ESLint 위반 0건
- [ ] P2-16 `structuredContent` 미지원 클라이언트 경로 — `content[0].text` 만으로 의미 완결 확인(수동: Inspector 에서 text 만 보고 답 가능)

### D. 보안·격리 (§5)
- [ ] P2-17 `walkMd` — 심볼릭 링크 엔트리(파일·디렉터리) 스킵 + 각 `.md` `realpath` 가 `<root>/wiki/` 하위인지 `path.relative` 판정(`..` 시작·절대경로면 제외), 제외 시 stderr 경고 1줄(내용 금지)
- [ ] P2-18 `wiki_read_page` — 대상 파일 `realpath` 동일 판정
- [ ] P2-19 `--root` 자체 `realpath` 정규화
- [ ] P2-20 쓰기 API 0개 — CI grep `writeFile|appendFile|unlink|rename|mkdir|rm(Sync)?\(` in `src/` → 0건
- [ ] P2-21 **심볼릭 링크 유출 테스트**(PRD §6) — 임시 볼트에 `wiki/leak.md → 외부 파일`, `wiki/leakdir → 외부 디렉터리` 를 만들고 `wiki_search`·`wiki_expand`·`wiki_pack`·`wiki_read_page` 전부 내용 미노출 확인(테스트 코드는 픽스처 밖 tmp 에 링크 생성, Windows 는 권한 없으면 skip 표기)
- [ ] P2-22 경로 탈출 테스트 — `../CLAUDE.local.md`, `wiki2/x`, 대소문자 변형, URL 인코딩 → 전부 거부
- [ ] P2-23 입력 상한 테스트 — terms 11개, 65자 term, slugs 31개, 200KB 초과 페이지

### E. CLI 서브커맨드 `src/cli.ts`, `src/print-config.ts`
- [ ] P2-24 `--selftest` — 페이지 수·MoC 수·buildGraph(ms)·프로세스 기동→ready(ms) 출력 후 종료
- [ ] P2-25 `print-config --client <claude-code|codex|gemini|agy|cursor|windsurf|claude-desktop|vscode> --root <r> [--windows] [--global]` — §8 매트릭스와 동일한 명령/JSON/TOML 출력, **파일 쓰기 없음**, 경로 인용 처리(공백·한글)
- [ ] P2-26 `print-config` 스냅샷 테스트 8종 × (기본/--windows/--global)
- [ ] P2-27 `--version`, `--help`

### F. 성능 (§6)
- [ ] P2-28 파일 read `fs.promises.readFile` 동시성 32, 정렬 목록 기준 재조립(순서 불변)
- [ ] P2-29 실볼트 `--selftest` 측정 — buildGraph <1s @ ≈315 페이지, 기동→ready <2s (npx 캐시 후). 결과 `todo/baseline/P2-perf.txt`
- [ ] P2-30 1,000 페이지 합성 볼트 생성 스크립트로 <3s 확인

### G. 검증
- [ ] P2-31 MCP Inspector 로 `tools/list` 4개 · 스키마 · description · instructions 확인(스크린샷 `todo/evidence/P2-inspector.png`)
- [ ] P2-32 Inspector 에서 사실브리핑 시나리오 수동 실행 — `wiki_expand(rerank=11)` → `suggested_next=wiki_pack` → `wiki_pack` 텍스트 확인
- [ ] P2-33 `--once` 와 MCP 도구 출력 텍스트 동일성 테스트(같은 코드 경로 증명)
- [ ] P2-34 패리티 CI 재실행 녹색(P1 회귀 없음)

## 산출물
- `src/server.ts`, `src/read.ts`, `src/print-config.ts`, `src/cli.ts`, 테스트(스키마 부분집합·보안·스냅샷·stdout)
- `todo/baseline/P2-perf.txt`, `todo/evidence/P2-inspector.png`

## 완료 기준 (DoD)
- [ ] A~G 전 항목 완료 또는 사유 명시
- [ ] 보안 테스트(P2-21~23) 전건 통과, 쓰기 API grep 0건
- [ ] 스키마 부분집합·도구명·description 길이·stdout 순수성 테스트 통과
- [ ] Inspector 확인 증거 보관
- [ ] 외부리뷰 완료

## 외부리뷰 (단계 종료 시 필수)
- 대상: `src/server.ts`, `read.ts`, `print-config.ts`, `cli.ts`, 보안 테스트, `tools/list` 덤프(JSON)
- 관점: ① 위협 모델 — 경로 탈출·심볼릭 링크·입력 상한·로그 유출에 남은 구멍 ② 도구 description·instructions 가 라우팅을 유도하기에 충분한가, 토큰 과다는 아닌가 ③ 스키마가 Gemini·Codex·Cursor 에서 거부될 요소가 남았는가 ④ `print-config` 출력이 각 클라이언트 실제 문법과 맞는가(§8 실측 기준) ⑤ `structuredContent`/`outputSchema` 사용이 SDK 계약에 맞는가
- 절차: `00-README.md` 규칙. 프롬프트 `review/P2-prompt.txt`, 결과 `review/P2-agy-YYYY-MM-DD.md` + `codex` 교차 리뷰 권장(보안 단계)

### 외부리뷰 반영
| # | 심각도 | 지적 요지 | 판정(수용/기각/상신) | 반영 위치 |
|---|---|---|---|---|
| | | | | |
