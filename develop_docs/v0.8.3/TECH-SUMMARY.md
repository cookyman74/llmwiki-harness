# 질의 리트리벌 최적화 — 기술 종합 (v0.8.4 → v0.8.6)

LLM 위키 질의 응답의 토큰·속도를 최적화한 3단계(v0.8.4~v0.8.6) 튜닝을 근거자료와 함께 정리. 모든 수치는 동일조건 A/B 실측(`metrics/ab-results.csv`).

---

## 1. 문제 정의

질의 응답이 질의당 52~62k 토큰 소모. 진단(2026-08-01 실측):
- `index.md`(218줄/22.6KB) **매 질의 통독**
- 광역 탐색: index→MoC 다수→페이지 12~19개 read
- 오케스트레이터가 후보 페이지를 프롬프트에 나열 → 전부 통독 유도

**핵심**: 페이지 자체는 작다(30~60줄). 비용은 크기가 아니라 **넓게 읽어서** 발생. 모델 교체는 최후 카드(이미 sonnet).

---

## 2. 적용 기술과 근거자료

### 2.1 그래프 확장 스코프 (v0.8.4)

**아이디어**: 키워드 lexical seed에서 멈추지 말고 **관계 1홉(아웃링크·인링크·MoC 멤버)**을 결정적으로 확장. 순수 lexical(grep)은 관계로 연결된 페이지(session·entity)에 못 닿아 recall이 깨진다.

**근거**: GraphRAG 계열 — 지식그래프의 엣지를 따라 관련 노드를 모으는 검색. 우리는 임베딩 없이 `[[wikilink]]` 그래프를 직접 파싱.
- Microsoft GraphRAG: https://microsoft.github.io/graphrag/
- 우리 구현: `scope-expand.py expand` (lexical seed → 1홉 확장 → lexical 필터 + MoC 멤버 Top-K)

**실측(A/B 4라운드)**: 광역탐색 대비 토큰 −37%·tool_uses −64%, recall 유지(순수 lexical의 회귀 복구).

### 2.2 claims 컨텍스트 팩 (v0.8.4) — Parent-Document Retriever

**아이디어**: 후보를 synthesizer가 N번 full-read하는 대신, 각 페이지의 **frontmatter + claims만** 뽑아 1파일로 전달. claims = 이미 증류된 사실.

**근거**: Parent-Document Retriever(small-to-big) — 작은 청크로 검색(정밀), 큰 부모 문서로 응답(맥락). 우리 팩(claims)=small-side, 페이지 full=parent.
- LangChain ParentDocumentRetriever: https://python.langchain.com/v0.2/docs/how_to/parent_document_retriever/
- Parent-document retrieval 개념: https://zeroentropy.dev/concepts/parent-document-retrieval/

**실측**: 사실질의 tool_uses 12→1~2(왕복 제거), 팩 1-read로 다중 페이지 대체.

### 2.3 질의유형 라우팅 (v0.8.5) — Adaptive-RAG

**아이디어**: 질의를 **조회/사실브리핑/절차**로 분류해 리트리벌 전략을 분기. 하나의 전략은 만능이 아니다(절차질의서 팩=오버헤드 발견).

**근거**: Adaptive-RAG — 질의 복잡도를 분류해 검색 전략을 다르게(무검색/단일/다단계). 항상 비싼 baseline을 저비용으로 따라잡음.
- Adaptive-RAG(질의복잡도 라우팅) survey: https://arxiv.org/pdf/2502.00409
- Adaptive RAG 개요(2025): https://www.meilisearch.com/blog/adaptive-rag

**라우팅 표**:
| 유형 | 스코프 | 전달 |
|---|---|---|
| 단일조회 | `--max 6` | seed 목록 |
| 사실브리핑·비교 | `--max 20 --rerank 11` | claims 팩 |
| 절차·how-to | `--max 8` | 후보 full-read(팩 없음) |

### 2.4 BM25 rerank (v0.8.5) — Reranking

**아이디어**: 그래프확장(recall)으로 모은 pool을 **질의 관련도로 top-N 축소**(precision). 팩/read 대상을 줄여 토큰 절감.

**근거**: Anthropic Contextual Retrieval — reranking으로 검색 실패 49%→67%↓. 모델이 덜 처리 → 비용·지연↓. 우리는 임베딩 없이 **BM25**(0토큰 결정적).
- Anthropic Contextual Retrieval: https://www.anthropic.com/engineering/contextual-retrieval
- BM25(Okapi) 공식: k1=1.5, b=0.75, idf=log((N−df+0.5)/(df+0.5)+1)

**실측**: 사실브리핑 rerank8+팩 = 22.7k/1read(baseline −55%). 단 rerank8은 recall 0.40으로 과공격(FirstPick 등 실항목 누락) → **rerank11이 균형**(비용↓ + 실항목 보존).

### 2.5 팩에 관계 포함 (v0.8.6)

**아이디어**: 관계중심 질의(엔티티 현황·차이)가 팩에서 `## 관계`(uses/depends_on 등)·연결 개념을 놓침. **새 라우트 대신 팩에 관계 줄 추가**(+300토큰).

**근거**: 관계질의 = 관계 실린 사실브리핑. full-read 라우트 신설(~38k)은 관계 몇 줄에 과한 비용 → 팩 내용 보강이 정답.

**실측**: 팩 4.6k→5.8k(+300토큰), connector-mcp·관계술어 커버. 22k/1read 이득 유지.

---

## 3. 통합 실측 결과

### 사실브리핑 질의 (Q2 차주 업무 / Q4 인증인프라)
| 방식 | tokens | tool_uses | 속도 |
|---|---|---|---|
| baseline(광역·index통독) | 50.6k | 14 | — |
| v0.8.4 그래프확장+팩 | 30.6k | 5 | |
| v0.8.5 rerank11+팩 | **~22k** | **1** | 32초 |
| **누적 개선** | **−55%** | **−93%** | **2.5배** |

### 절차 질의 (Q3 Codex CI/CD)
| 방식 | tokens | tool_uses |
|---|---|---|
| baseline | 39.5k | 8 |
| 팩 / full-read | ~38k | 10~12 |
| **결론** | 동률 | 절차는 스코핑 이득 없음(본질적으로 다페이지 세부 필요) |

---

## 4. 교훈 (실측으로 검증)

1. **관계 도달은 lexical로 안 됨** — 그래프 1홉 확장 필수(session·entity는 링크로만 닿음).
2. **claims 팩은 사실질의에만 이득** — 절차질의는 세부 넓이가 필요해 팩=오버헤드. 라우팅으로 분기.
3. **rerank는 최대 레버지만 다이얼** — 조이면 싸지고 recall 준다(8=과함, 11=균형). 무료점심 아님.
4. **recall의 진짜 레버는 `--max`가 아니라 키워드 품질**(엔티티 포함). max25는 recall 안 올리고 팩만 비대.
5. **절차질의 비용은 근본적** — 스코핑으로 못 줄임. 반복비용은 환류 캐시(query 페이지)로만.
6. **관계질의는 새 유형 아님** — 팩에 관계 실으면 사실브리핑 라우트로 커버.

---

## 5. 구현 (scope-expand.py — 결정적 0토큰)

- `expand <kw…> [--top-seed N] [--max M] [--rerank K]`: lexical seed → 관계 1홉 확장 → (옵션)BM25 rerank top-K.
- `pack <slug…>`: frontmatter(type/conf/status) + claims:: + `## 관계` 줄 추출(코드펜스 추적). 컨텍스트 팩.
- 링크 그래프: `[[…]]` 파싱, 별칭→slug 정규화, 인링크 역맵. 이미지 임베드 `![[…]]` 제외.
- 크로스플랫폼: utf-8-sig·errors=replace·stdout.reconfigure.

**외부감사(agy) 반영 이력**: MoC멤버 lexical필터 우회+Top-K(recall) · 이미지임베드 제외 · pack 요약문단 정제 · BM25 term중복제거·dl 링크왜곡정제·slug 타이브레이크 · 관계추출 코드펜스 추적·claim 중복제외.

---

## 6. 참고자료 (전체)

**리트리벌 기법**
- Adaptive-RAG 라우팅 survey — https://arxiv.org/pdf/2502.00409
- Parent-Document Retriever (LangChain) — https://python.langchain.com/v0.2/docs/how_to/parent_document_retriever/
- Parent-document retrieval 개념 — https://zeroentropy.dev/concepts/parent-document-retrieval/
- Anthropic Contextual Retrieval(+reranking) — https://www.anthropic.com/engineering/contextual-retrieval
- LangChain Contextual Compression — https://blog.langchain.com/improving-document-retrieval-with-contextual-compression/
- Self-RAG — https://www.meilisearch.com/blog/self-rag
- Stop-RAG(가치기반 정지) — https://arxiv.org/pdf/2510.14337
- AB-RAG(적응 예산) — https://arxiv.org/pdf/2606.29090
- Microsoft GraphRAG — https://microsoft.github.io/graphrag/

**관련 설계 문서**
- `develop_docs/v0.8.3/PRD.md` · `DESIGN.md` · `AB-TEST.md`
- `develop_docs/v0.8.5/COMBO.md`
- 실측 원장: `metrics/ab-results.csv`
