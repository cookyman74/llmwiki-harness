---
type: concept
title: 재순위
aliases: [rerank, 재순위, reranking]
tags: [fixture]
created: 2026-09-01
updated: 2026-09-09
confidence: 0.85
sources: [latency-review, search-briefing]
---

# 재순위 (rerank)

- claim:: rerank는 1차 후보를 질의 관련도로 다시 정렬해 precision을 올린다.
- claim:: Northwind는 BM25 기반 rerank를 top-11로 자른다.

아래는 문서 예시용 코드 블록이다. 이 안의 관계·claim은 실제 관계가 아니다.

```markdown
- uses :: [[fake-target-in-fence]]
- claim:: 펜스 안 클레임은 claims 추출에 포함된다(정본 비대칭)
```

## 관계
- uses :: [[concept-vector-index]] (sources: 2, confidence: 0.85)
- contradicts :: [[fact-latency-budget-old]]
