---
type: entity
title: Northwind 검색 서비스
aliases: [Northwind Search, 노스윈드 검색]
tags: [fixture]
created: 2026-09-01
updated: 2026-09-09
confidence: 0.95
sources: [northwind-kickoff, latency-review, search-briefing]
decay_class: entity
---

# Northwind 검색 서비스

- claim:: Northwind 검색 서비스는 사내 문서 검색 플랫폼이다.
- claim:: 검색 파이프라인은 청킹 → 벡터 인덱스 → rerank 순서다.

운영 주체는 [[entity-northwind-team]]이다.

## 관계
- 사용함 :: [[concept-chunking]] (sources: 3, confidence: 0.95)
- 사용함 :: [[concept-vector-index]]
  - uses :: [[concept-reranking]]
- owned_by :: [[entity-northwind-team]]
