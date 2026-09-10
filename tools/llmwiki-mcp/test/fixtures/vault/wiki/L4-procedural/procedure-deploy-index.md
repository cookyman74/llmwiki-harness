---
type: procedure
title: 인덱스 배포 절차
aliases: []
tags: [fixture]
created: 2026-09-01
updated: 2026-09-09
confidence: 0.85
sources: [northwind-kickoff, latency-review]
---

# 인덱스 배포 절차

- claim:: 인덱스 배포는 청킹 → 임베딩 → 벡터 인덱스 빌드 → 스모크 질의 순서다.

## steps
1. [[concept-chunking]] 설정 확인
2. [[concept-vector-index]] 빌드
3. [[concept-evaluation-harness]]로 골든셋 질의
