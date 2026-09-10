---
type: concept
title: 청킹
aliases: [chunking, 청킹]
tags: [fixture]
created: 2026-09-01
updated: 2026-09-09
confidence: 0.6
sources: [northwind-kickoff]
---

# 청킹

- claim:: 청킹(chunking)은 문서를 검색 단위로 자르는 전처리다.
- claim:: Northwind는 512토큰 청킹을 기본값으로 쓴다.

청킹 크기는 [[concept-vector-index]] 품질과 [[fact-latency-budget]]에 함께 영향을 준다.
