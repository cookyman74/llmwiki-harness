---
name: wiki-moc
description: How to build and maintain the MoC (Map of Content) navigation layer of the LLM wiki — create/refresh topical MoC hub pages, keep the home-moc hierarchy coherent, graft new pages into the right map, and ensure every page is reachable from a MoC. Use for MoC 생성/갱신, 네비게이션 정리, 지도 페이지, 새 페이지 편입.
---

# wiki-moc

MoC(Map of Content)는 위키의 **네비게이션 뼈대**다. 큐레이션된 허브 페이지가 관련 노트를 주제별로 묶어, 폴더 계층이나 그래프 뷰 없이도 위키를 항해하게 한다.

## MoC vs index.md — 섞지 마라
| | index.md | MoC |
|---|---|---|
| 성격 | 전수 카탈로그 (기계적) | 큐레이션 주제 지도 (사람이 읽음) |
| 범위 | 모든 페이지 1회씩 | 주제별 선별·그룹핑 |
| 갱신 | 인제스트마다 자동 | 주제 성장 시 큐레이션 |
| 계층 | 평면 (카테고리별) | 계층적 (home → 주제 → 하위) |

둘 다 유지한다. index는 "빠짐없이", MoC는 "이해되게".

## MoC 페이지 구조
`wiki/moc/{topic}-moc.md`:
```markdown
---
type: moc
title: <한국어 주제명> MoC
aliases: [<주제명> 지도]
tags: [moc, <topic>]
created: <오늘>
updated: <오늘>
---

# <한국어 주제명> MoC

> [!info]
> <이 지도가 다루는 범위 1–2문장. 손수 쓴 서문 — 갱신 시 보존.>

## 상위
- [[home-moc]]

## 노트
<!-- 아래는 자동 갱신 구역: 편입된 페이지 목록 -->
- [[page-a]] — <한 줄 설명>
- [[page-b]] — <한 줄 설명>

### <하위 테마 그룹>
- [[page-c]] — <설명>

## 미작성 (stub)
- [[topic-to-write]]
```

## 계층
- 최상위 허브: `wiki/moc/home-moc.md` — 모든 주제 MoC를 가리킨다. 위키의 현관.
- 각 주제 MoC는 `## 상위`에서 `[[home-moc]]`(또는 부모 MoC)로 되돌아 링크 — 양방향 항해.
- 주제가 비대해지면(20+ 페이지) 하위 MoC로 분할하고 부모에 링크. 얇으면(2–3) 병합 제안.

## 절차

**신규 MoC 생성:** 위 구조로 만들고, 관련 페이지를 `## 노트`에 그룹핑 + 한 줄 설명. `home-moc`에 이 MoC 링크 추가. index.md에도 등록.

**기존 MoC 갱신:** 손수 쓴 서문·수동 섹션은 **보존**하고, `## 노트` 자동 구역만 재생성. `updated:` 갱신.

**신규 페이지 편입 (인제스트 후):** 각 새 페이지의 주제를 판단해 알맞은 MoC의 `## 노트`에 한 줄 설명과 함께 추가. 맞는 MoC가 없으면 새 MoC 생성 또는 사용자에게 확인. 귀속 모호하면 "미분류" 섹션 임시 배치.

**도달성 점검:** 모든 **L3-semantic·L4-procedural** 페이지가 ≥1 MoC에서 도달 가능한지 확인. L1-working·L2-episodic 기록(세션·소스)은 MoC 대상 아님(휘발·증거 계층). `link-audit.py`의 orphan에 더해, MoC에서 시작한 링크 그래프로 도달 불가 L3/L4 페이지를 찾아 편입 대상으로 보고.

## 큐레이션 원칙
MoC는 모든 링크를 쏟아붓는 곳이 아니다 — 주제 응집도에 맞게 **선별·그룹핑**하고, 각 링크에 왜 여기 있는지 한 줄 설명을 붙인다. 좋은 MoC는 그 자체로 주제 개요처럼 읽힌다.
