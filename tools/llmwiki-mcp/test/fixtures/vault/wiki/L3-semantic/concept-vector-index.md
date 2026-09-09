---
type: concept
title: 벡터 인덱스
aliases: [벡터 인덱스, vector index]
tags: [fixture]
created: 2026-09-01
updated: 2026-09-09
confidence: 0.85
sources: [northwind-kickoff, latency-review]
status: active
---

# 벡터 인덱스

- claim:: 벡터 인덱스는 임베딩을 근사 최근접 탐색 구조로 저장한다.
- claim:: Northwind 검색은 HNSW 벡터 인덱스를 기본으로 쓴다.

벡터 인덱스를 만들기 전에 [[concept-chunking]]으로 문서를 나눈다. 결과는 [[concept-reranking]]으로 재순위한다.

## 관계
- depends_on :: [[concept-chunking]] (sources: 2, confidence: 0.85)
- used_by :: [[entity-northwind-search]]
