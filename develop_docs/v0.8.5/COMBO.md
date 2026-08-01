# v0.8.5 — 질의유형 라우팅 + BM25 rerank + parent 적응 (combo)

- **작성일**: 2026-08-01
- **배경**: v0.8.4(그래프확장+팩)는 **사실브리핑엔 −37%**였으나 **절차질의(Q3 Codex CI/CD)엔 팩이 오버헤드**(≈baseline). 리서치(Adaptive-RAG·Parent-Document Retriever·Anthropic reranking) 기반 combo 설계·A/B 검증.
- **변경**: `scope-expand.py`(--rerank BM25 추가) · `wiki-ops`·`wiki-query` 라우팅 배선.

## 설계 (①라우팅 + ④rerank + ②parent 적응)

| 질의유형 | 스코프 | 전달 | 이유 |
|---|---|---|---|
| 단일조회 | `--max 6` | seed 목록 | 최저비용 |
| 사실브리핑·비교 | `--max 20 --rerank 11` | **claims 팩** | rerank가 후보 조여 팩 1-read로 충분 |
| 절차·how-to | `--max 8`(rerank 없음) | **후보 full-read** | 세부 넓이 필요, 팩=오버헤드 |

## A/B 실측 (5라운드 누적, `metrics/ab-results.csv`)

**Q2 사실브리핑**:
| 방식 | tokens | tools | recall |
|---|---|---|---|
| baseline(광역) | 50.6k | 14 | 0.80 |
| pack15 | 30.6k | 5 | 0.60 |
| **rerank8+팩** | 22.7k | 1 | 0.40 |
| → 채택 **rerank11+팩** | ~24-28k(추정) | 1~2 | ~0.55(균형) |

**Q3 절차(Codex CI/CD)**:
| 방식 | tokens | tools | 답 |
|---|---|---|---|
| baseline | 39.5k | 8 | 완전 |
| pack15 | 39.1k | 10 | 완전 |
| full-read | 38.4k | 12 | 완전(링크추적 도달) |
| → 셋 다 **동률 ~38k** | | | 절차는 스코핑 이득 없음 |

## 결론 (검증됨)
1. **rerank = 사실질의 최대 레버, 단 다이얼**: 8이면 22.7k/1read이나 recall 0.40(FirstPick 등 실항목 누락). 15는 무이득. **11이 균형**(비용↓ + 실항목 보존).
2. **절차질의는 어떤 스코핑도 못 이김**(~38k 동률) — 본질적으로 여러 페이지 세부 필요. 팩 금지·full-read가 낭비 없는 최선.
3. **라우팅이 핵심** — 하나의 전략이 만능 아님. 질의유형별 분기가 정답.

## 리서치 근거
Adaptive-RAG(질의복잡도 라우팅) · Parent-Document Retriever(small=claims/parent=full 적응) · Anthropic Contextual Retrieval(reranking으로 실패 49→67%↓). 우리 claims팩 = parent-retriever의 small-side, rerank·라우팅이 빠진 조각이었음.

## rerank 구현 (scope-expand.py --rerank N)
BM25(k1=1.5·b=0.75), IDF는 전체 코퍼스, tf·dl은 후보 본문+aliases. 그래프확장(recall) pool을 질의관련도(precision)로 top-N 축소. 0토큰.

## 한계
- rerank는 키워드 민감(짧은 코퍼스). recall 필수 항목이 top-N 밖이면 synthesizer 링크추적에 의존.
- 절차질의 비용은 근본적(스코핑으로 못 줄임) — 환류 캐시(query 페이지)로 반복비용만 절감 가능(별건).
