# LLM Wiki — Obsidian 볼트를 LLM이 유지보수하는 지식 베이스로 운영하기

[![CI](https://github.com/cookyman74/llmwiki-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/cookyman74/llmwiki-harness/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-informational)](https://github.com/cookyman74/llmwiki-harness/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.x-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-vault-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-harness-d97757)](https://claude.ai/code)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/cookyman74/llmwiki-harness/pulls)

> Obsidian을 IDE로, LLM을 프로그래머로, 위키를 코드베이스로. 사용자는 소스를 큐레이션하고 질문하고, LLM이 요약·교차참조·정리·부기(bookkeeping)를 전부 한다.

**👉 처음이라면 [INTRO.md](INTRO.md) 부터 — 이게 뭐고 왜 쓰는지 3분 소개.**

이 문서 하나만 따라 하면 **빈 Obsidian 볼트**에서 시작해 **자기 유지보수(self-maintaining) LLM 위키 하네스**를 그대로 재현할 수 있다.

- **대상 도구:** [Claude Code](https://claude.ai/code) (CLI/데스크톱/IDE)
- **언어:** 노트 본문 한국어 / 파일명 영문 kebab-case
- **버전:** v2.1 (통합 계층 기억 + lazy 인제스트·모델 라우팅) — v1(평평 구조) → v2(4계층·신뢰도·망각) → v2.1(비용 최적화)

---

## 목차

1. [핵심 아이디어](#1-핵심-아이디어)
2. [아키텍처 — 3계층 저장 + 4계층 기억](#2-아키텍처)
3. [디렉토리 구조 전체](#3-디렉토리-구조-전체)
4. [처음부터 재현하기 (Setup)](#4-처음부터-재현하기-setup)
5. [하네스 구성요소 — 에이전트·스킬·스크립트](#5-하네스-구성요소)
6. [사용법 — 5가지 오퍼레이션](#6-사용법--5가지-오퍼레이션)
6.5. [일상 응용 시나리오](#65-일상-응용-시나리오-단순-qa를-넘어)
7. [v2 메커니즘 상세](#7-v2-메커니즘-상세)
7.5. [질의 리트리벌 최적화 (v0.8.4~v0.9.0)](#75-질의-리트리벌-최적화-v084v090)
8. [Frontmatter 스키마 레퍼런스](#8-frontmatter-스키마-레퍼런스)
9. [스크립트 레퍼런스](#9-스크립트-레퍼런스)
10. [Obsidian 설정 팁](#10-obsidian-설정-팁)
11. [하네스 진화·확장](#11-하네스-진화확장)
12. [트러블슈팅](#12-트러블슈팅)
13. [설계 결정 요약](#13-설계-결정-요약)

---

## 1. 핵심 아이디어

대부분의 "LLM + 문서" 경험은 **RAG**다: 파일을 올리면 LLM이 질문마다 관련 조각을 검색해 답을 만든다. 문제는 **누적이 없다**는 것 — 매 질문마다 지식을 처음부터 재발견한다.

**LLM Wiki**는 다르다. LLM이 원본 소스와 당신 사이에 **영속적인 위키**(구조화·상호링크된 마크다운 파일 모음)를 **점진적으로 만들고 유지**한다. 새 소스를 넣으면 LLM은:

1. 소스를 읽고 핵심 정보를 추출
2. 기존 위키에 **통합** — 엔티티 페이지 갱신, 요약 수정, 새 데이터가 옛 주장과 충돌하면 표시
3. 교차참조·모순 표시·종합을 **한 번 컴파일해두고 계속 최신화**

즉 위키는 **복리로 쌓이는 산출물**이다. 교차참조는 이미 걸려 있고, 모순은 이미 표시돼 있고, 종합은 이미 읽은 모든 것을 반영한다.

**역할 분담:**
- **사람:** 소스 큐레이션, 탐색 방향 결정, 좋은 질문
- **LLM:** 요약·교차참조·정리·부기 — 위키를 지치지 않고 유지 (한 번에 15개 파일 갱신)

관련 정신: Vannevar Bush의 **Memex**(1945) — 개인이 큐레이션하는 지식 저장소, 문서 간 연상 경로. 그가 못 푼 것 = "누가 유지보수하나?". LLM이 그 답이다.

---

## 2. 아키텍처

### 2-1. 3계층 저장 (Storage)

| 계층 | 위치 | 소유 | 규칙 |
|------|------|------|------|
| **Raw sources** | `raw/` | 사용자 | **본문 immutable** — 내용 수정 금지, 진실의 원천. 단 인제스트 완료 스탬프(`ingested`/`wiki_source`/`ingest_status`)는 맨 위 메타 블록만 예외(본문 무변경). |
| **The wiki** | `wiki/` | LLM | LLM이 전부 생성·유지. 사용자는 읽기만. |
| **The schema** | `CLAUDE.md` | 공동 | 구조·규약·워크플로우의 정본. 함께 진화. |

### 2-2. 4계층 기억 (Memory Tiers) — v2 핵심

v1의 한계(**모든 정보가 영원히 동등**·**평평한 구조**·**품질 통제 없음**)를 풀기 위해, 인간 기억 구조를 본떠 정보에 **등급·시간·신뢰도**를 부여한다. 정보는 아래층(휘발·구체)에서 위층(영속·추상)으로 **반복·시간·신뢰도에 따라 승격**한다.

```
raw/  ──▶  L1-working  ──▶  L2-episodic  ──▶  L3-semantic  ──▶  L4-procedural
소스        작업기억         일화기억           의미기억            절차기억
(불변)      세션 스크래치     세션·소스 증거      사실·엔티티(신뢰도)   방법 steps
            세션종료시 비움    "언제 무엇을"       증류된 지식          반복된 절차
```

| 계층 | 폴더 | 담는 것 | 대표 파일 |
|------|------|---------|-----------|
| **L1 작업기억** | `wiki/L1-working/` | 현재 세션 관찰·스크래치 | (임시, 세션 종료 시 비움) |
| **L2 일화기억** | `wiki/L2-episodic/` | 세션 요약, 소스 증거 | `session-YYYY-MM-DD.md`, `source-*.md` |
| **L3 의미기억** | `wiki/L3-semantic/` | 사실·엔티티·개념 (신뢰도 부여) | `fact-*.md`, `entity-*.md`, `concept-*.md` |
| **L4 절차기억** | `wiki/L4-procedural/` | 반복 관찰된 방법 (steps) | `procedure-*.md` |
| **MoC (네비)** | `wiki/moc/` | 큐레이션 주제 지도 | `home-moc.md`, `{topic}-moc.md` |

**승격 규칙:**
- **L1 → L2** (세션 종료 시): L1 관찰을 3–5줄로 압축 → `session-*.md` 저장 → L1 비움
- **L2 → L3** (lint 시): 같은 주장이 **3회 이상** 등장 → `fact-*.md`로 승격 (모순 있으면 보류)
- **L3 → L4** (lint 시): 같은 절차가 **2회 이상** 관찰 → `procedure-*.md`로 추출

### 2-3. 특수 파일 두 개

- **`index.md`** — 내용 지향. 위키 전체 카탈로그(페이지 + 한 줄 요약). 인제스트마다 자동 갱신. 질의 시 여기부터 읽어 관련 페이지를 찾는다.
- **`log.md`** — 시간 지향. append-only 기록. 각 항목 `## [YYYY-MM-DD] <op> | <제목>` 프리픽스 고정 → `grep "^## \[" log.md | tail -5`로 최근 이력 조회.

> **index.md vs MoC 차이:** index는 "빠짐없이"(전수·기계적·평면), MoC는 "이해되게"(선별·큐레이션·계층). 둘 다 유지하되 역할을 섞지 않는다.

---

## 3. 디렉토리 구조 전체

```
llmwiki.obsidian/
├── CLAUDE.md                  # ★ 스키마 — 매 세션 로딩되는 정본 (규약·신뢰도·망각·관계 규칙)
├── CLAUDE.local.md            # 개인 프로필 (gitignore — 공유 안 됨)
├── README.md                  # 이 문서
├── index.md                   # 전수 카탈로그 (자동 갱신)
├── log.md                     # 시간순 append-only 로그
│
├── raw/                       # 원본 소스 (본문 immutable, 인제스트 스탬프만 예외)
│   ├── assets/                # 다운로드한 이미지
│   ├── meetings/              # 회의록 (verbal 소스)
│   ├── notes/                 # 데일리 노트 (스크래치 — pending 스캔 제외)
│   └── ...                    # 자유 분류 (lecture/·article/·books/ 등)
│
├── wiki/                      # LLM 소유 — 4계층 기억
│   ├── L1-working/            # 세션 스크래치 (종료 시 비움)
│   ├── L2-episodic/           # session-*.md, source-*.md
│   ├── L3-semantic/           # fact-*.md, entity-*.md, concept-*.md (신뢰도)
│   ├── L4-procedural/         # procedure-*.md (steps)
│   └── moc/                   # 네비게이션 지도 (home-moc.md 현관 + {topic}-moc.md)
│
├── templates/                 # Obsidian 템플릿
│   ├── meeting.md             # 회의록 (→ raw/meetings/)
│   ├── daily.md               # 오늘의 노트 (→ raw/notes/)
│   └── seeds/                 # 빈 시드 (index·log·home-moc — 배포본 초기화용)
│
├── metrics/                   # 비용대비효과 측정
│   ├── ingest-cost.csv        # 문서당 토큰·페이지·모델 원장 (gitignore)
│   └── cost-report.py         # 모델가중 비용 리포트
│
└── .claude/                   # 하네스
    ├── settings.json          # 훅 (SessionStart 자동 점검 + PostToolUse updated 스탬프)
    ├── agents/                # 전문가 정의 (누가) — 6개
    │   ├── wiki-ingestor.md        (model: sonnet)
    │   ├── wiki-synthesizer.md
    │   ├── wiki-linter.md
    │   ├── wiki-cartographer.md
    │   ├── wiki-consolidator.md
    │   └── meeting-scribe.md       (model: sonnet)
    └── skills/                # 워크플로우 정의 (어떻게)
        ├── wiki-ops/          # ★ 오케스트레이터 (진입점)
        ├── wiki-ingest/       # 인제스트 절차 (lazy)
        │   └── scripts/       # concept-index.py
        ├── wiki-query/        # 질의 절차
        ├── wiki-lint/         # 점검 절차
        │   └── scripts/       # link-audit.py, decay.py, lint-due.py, search.py,
        │                      # ingest-status.py, wiki-status-check.py
        ├── wiki-moc/          # MoC 절차
        ├── wiki-consolidate/  # 통합·배치병합 절차
        │   └── scripts/       # confidence.py, list-claims.py
        ├── weekly-review/     # 주간 리뷰 자동화
        └── meeting-minutes/   # 녹음 → 전사 → 회의록 (로컬/OpenAI 이중 백엔드)
            ├── scripts/       # transcribe.py, apikey.py
            └── references/    # backend-setup.md
```

---

## 4. 처음부터 재현하기 (Setup)

세 갈래가 있다. **하네스 repo를 받았다면 방법 C가 가장 빠르다.**

### 방법 C — git clone로 하네스 배포본 받기 (가장 빠름)

누군가 공유한 하네스 repo(구조·스킬만, 콘텐츠 제외)를 받아 바로 운영을 시작한다.

```bash
git clone <하네스-repo-URL> my-wiki && cd my-wiki
```

1. **개인 프로필 작성** — `CLAUDE.local.md`를 만들어 자기 소개를 적는다(gitignore라 공유 안 됨). Claude가 세션마다 로딩해 설명 톤을 맞춘다:
   ```markdown
   # CLAUDE.local.md
   ## 목적 / 사용자 프로필
   - 역할: (백엔드 개발자 / 데이터 사이언티스트 / …)
   - 스택: (언어·프레임워크·인프라)
   - 관심/학습: (현재 파고드는 주제)
   ```
2. **시드 복사** — 빈 색인·로그·현관 MoC를 제자리로:
   ```bash
   cp templates/seeds/index.md templates/seeds/log.md .
   cp templates/seeds/home-moc.md wiki/moc/
   ```
3. **Claude Code 실행** → `/hooks` 한 번 열기(훅 로드) → Obsidian에서 볼트 열기.
4. `raw/`에 첫 소스를 넣고 "인제스트해줘" → 위키가 자란다.

> **업데이트 받기:** `git pull`. 하네스(스킬·에이전트·스크립트)만 갱신되고 내 콘텐츠는 그대로다.
> **내가 하네스를 고쳐 재배포:** `git add .claude/ CLAUDE.md README.md templates/ && git commit && git push` — 콘텐츠·프로필은 `.gitignore`라 안 올라간다.

### 방법 A — myharness 팩토리로 자동 생성 (권장)

이 하네스는 [myharness](https://github.com/) 플러그인(에이전트 팀 + 스킬 자동 구성 메타 스킬)으로 만들어졌다.

1. **Obsidian 볼트 생성** — Obsidian에서 새 볼트를 만든다 (예: `llmwiki.obsidian`).
2. **Claude Code를 볼트 디렉토리에서 실행** — `cd <볼트경로> && claude`.
3. **`/init` 실행** (선택) — 기본 CLAUDE.md·규약 스캐폴딩.
4. **myharness 실행** — LLM Wiki 아이디어 문서를 인자로 넘겨 하네스 구성 요청:
   ```
   /myharness:myharness <LLM Wiki 패턴 설명 + "MoC 네비게이션 포함" 요청>
   ```
5. myharness가 Phase 0~7로 에이전트·스킬·스크립트·CLAUDE.md·훅을 생성한다.
6. **v2 업그레이드** — 개선안(신뢰도·덮어쓰기·망각·4계층·엔티티·자동화)을 다시 myharness에 넘겨 아키텍처 변경을 요청하면 이 문서의 v2 구조로 확장된다.

### 방법 B — 수동 재현 (구조를 직접 만들기)

myharness 없이 파일을 직접 만들 때. 볼트 루트에서:

**1) 디렉토리 스캐폴딩**
```bash
mkdir -p raw/assets
mkdir -p wiki/L1-working wiki/L2-episodic wiki/L3-semantic wiki/L4-procedural wiki/moc
mkdir -p .claude/agents
mkdir -p .claude/skills/wiki-ops
mkdir -p .claude/skills/wiki-ingest
mkdir -p .claude/skills/wiki-query
mkdir -p .claude/skills/wiki-lint/scripts
mkdir -p .claude/skills/wiki-moc
mkdir -p .claude/skills/wiki-consolidate/scripts
# 빈 폴더가 git/OneDrive에서 유지되도록
find raw wiki -type d -exec touch {}/.gitkeep \;
```

**2) 파일 작성** — 아래 [5장](#5-하네스-구성요소)·[8장](#8-frontmatter-스키마-레퍼런스)·[9장](#9-스크립트-레퍼런스)의 내용을 각 경로에 만든다:
- `CLAUDE.md` (스키마 — 8장 frontmatter + 7장 규칙)
- `.claude/agents/*.md` (5개 전문가 — 5-1장)
- `.claude/skills/*/SKILL.md` (6개 스킬 — 5-2장)
- 스크립트 10개 (9장) — 작성 후 `chmod +x`
- `.claude/settings.json` (훅 — 7-6장)
- `index.md`, `log.md`, `wiki/moc/home-moc.md` (시드)

**3) 활성화**
```bash
# 스크립트 실행권한
chmod +x .claude/skills/wiki-lint/scripts/*.sh .claude/skills/wiki-lint/scripts/*.py
chmod +x .claude/skills/wiki-consolidate/scripts/*.sh .claude/skills/wiki-consolidate/scripts/*.py
chmod +x .claude/skills/wiki-ingest/scripts/*.sh metrics/cost-report.py
```
- Claude Code에서 **`/hooks`를 한 번 열어** 새 훅을 로드한다 (세션 중 추가된 훅은 설정 watcher가 즉시 못 잡는다 — `/hooks` 열기 또는 재시작 필요).

### 사전 요구사항

- **Claude Code** 설치
- **python3** (모든 결정적 스크립트 + 훅 — 표준 라이브러리만 사용)
- (선택) **Obsidian** — 위키를 사람이 브라우징. 그래프 뷰로 위키 형태를 본다.

> **크로스플랫폼:** 모든 스크립트·훅이 **python3 전용**이다(bash·grep·awk·jq·rg 불필요). 따라서:
> - **macOS·Linux** — 그대로 작동 (python3 기본/쉬운 설치).
> - **Windows** — **네이티브로 작동** (python3만 PATH에 있으면 됨; WSL·Git Bash 불필요). 단 훅 명령이 `python3`를 부르므로 Windows에서 `python`만 있으면 `python3` 별칭을 잡아주거나 PATH에 `python3` 확보.
> - 줄바꿈은 `.gitattributes`가 LF로 정규화(Windows CRLF 손상 방지).

---

## 5. 하네스 구성요소

핵심 설계: **에이전트(누가) + 스킬(어떻게) 분리.** 에이전트는 역할·원칙·프로토콜을, 스킬은 절차·템플릿을 담는다.

**실행 모드: 전문가 풀 (서브 에이전트 디스패치).** 오퍼레이션마다 전문가 **1명**을 호출한다 — 동시 협업 팀이 아니다. 한 소스 인제스트는 교차참조·신뢰도 일관성을 위해 **단일 에이전트**가 통째로 처리한다(분할하면 페이지 충돌).

### 5-1. 에이전트 (6명)

| 에이전트 | 역할 | 사용 스킬 | 모델 |
|----------|------|-----------|------|
| **wiki-ingestor** | 소스 인제스트 (lazy) — L2 증거 + **신규 L3 초안만**. 병합·신뢰도·덮어쓰기·관계는 lint 배치로 지연 | wiki-ingest, wiki-moc | **sonnet** |
| **wiki-synthesizer** | 질의 응답 — index→MoC→L3 탐색, 신뢰도·최신성 반영 인용 답변, 환류 | wiki-query, wiki-moc | opus |
| **wiki-linter** | 건강 검진 — 링크·망각·신뢰도 감사, 승격 후보, 모순 검사 | wiki-lint, wiki-consolidate, wiki-moc | opus |
| **wiki-cartographer** | MoC 네비게이션 — 허브 생성·갱신, L3/L4 편입, 도달성 점검 | wiki-moc | opus |
| **wiki-consolidator** | 기억 통합 — L1→L2 압축, L2→L3→L4 승격, 신뢰도 재계산 + **lazy 후속 배치 병합**(기존 페이지 통합·관계 구조화·중복 초안 정리) | wiki-consolidate, wiki-moc | opus |
| **meeting-scribe** | 전사문 → 회의록 — 결정·액션·미결 분리, 근거 있을 때만 발언 귀속. 2만 자 전사문을 격리 컨텍스트에서 소비 | meeting-minutes | **sonnet** |

> **모델 라우팅(v2.1):** 인제스트는 추출·파일쓰기 위주라 **sonnet**(빈번한 경로를 싸게). 병합 판단·종합·감사 같은 고추론은 나머지 4개 에이전트가 **opus**로. 측정상 인제스트 페이지당 실질비용 ~4.6×↓·지연 ~3×↓.

각 에이전트 정의 파일(`.claude/agents/{name}.md`)의 frontmatter는 **연결 계약**을 담는다:
```yaml
---
name: wiki-ingestor
description: <언제 이 에이전트를 쓰나 — pushy하게>
tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch
model: sonnet   # 인제스트=sonnet, 나머지 에이전트=opus (모델 라우팅)
skills: [wiki-ingest, wiki-moc]   # 이 에이전트가 쓰는 스킬 (구성 자기평가용)
---
```
본문 섹션: `핵심 역할` · `작업 원칙` · `입력/출력 프로토콜` · `이전 산출물이 있을 때` · `에러 핸들링` · `협업`.

### 5-2. 스킬 (8개)

| 스킬 | 유형 | 하는 일 |
|------|------|---------|
| **wiki-ops** | 오케스트레이터 (진입점) | Phase 0 컨텍스트 확인 → 라우팅 → 오퍼레이션 흐름 조율 |
| **wiki-ingest** | 워크플로우 | (lazy) 소스 → L2 증거 + 신규 L3 초안 (병합·신뢰도·관계·승격은 lint 지연) |
| **wiki-query** | 워크플로우 | 탐색 → 신뢰도 반영 인용 답변 → 환류 |
| **wiki-lint** | 워크플로우 | 스크립트 검사 → 망각·신뢰도·supersession 감사 → 배치 승격 → 추론 검사 |
| **wiki-moc** | 워크플로우 | MoC 허브 구조·계층·편입·도달성 |
| **wiki-consolidate** | 워크플로우 | 4계층 승격 (L1→L2→L3→L4) + **lazy 후속 배치 병합**(신뢰도·관계·기존 통합) |
| **weekly-review** | 워크플로우 | 주간 리뷰 자동 생성 — 완료·미결·stale·다음주 우선순위 → query 페이지 파일링 |
| **meeting-minutes** | 워크플로우 | 녹음 → 전사 → 회의록. **회의 민감도로 백엔드 분기**(로컬 온디바이스 / OpenAI API) |

오케스트레이터 frontmatter는 **`orchestrates:` 배열**로 조율하는 에이전트를 선언:
```yaml
---
name: wiki-ops
description: <pushy — 인제스트·질의·린트·MoC·통합 + 후속 키워드>
orchestrates: [wiki-ingestor, wiki-synthesizer, wiki-linter, wiki-cartographer, wiki-consolidator]
---
```

### 5-3. 스크립트 (10개, 결정적 — LLM 토큰 0)

계산은 스크립트가, 의미 판단만 LLM이. 상세는 [9장](#9-스크립트-레퍼런스).

| 스크립트 | 위치 | 용도 |
|----------|------|------|
| `confidence.py` | wiki-consolidate/scripts | 소스 수·유형 → 신뢰도 점수 |
| `list-claims.py` | wiki-consolidate/scripts | L2 주장(claim::) 수집 → 배치 병합·승격 |
| `concept-index.py` | wiki-ingest/scripts | 기존 L3/L4 카탈로그 (본문 Read 없이 신규/기존 판별 — lazy의 핵심) |
| `decay.py` | wiki-lint/scripts | Ebbinghaus 망각 보존율 계산·스캔 |
| `link-audit.py` | wiki-lint/scripts | 끊긴 wikilink + 고아 + 누락 타겟(stub_targets) |
| `lint-due.py` | wiki-lint/scripts | 마지막 lint 경과일 + L1 미압축 수 |
| `ingest-status.py` | wiki-lint/scripts | raw 인제스트 상태 (done/pending) |
| `wiki-status-check.py` | wiki-lint/scripts | SessionStart 훅 — lint 경과·L1·미인제스트 알림 |
| `search.py` | wiki-lint/scripts | grep 기반 위키 본문 검색 |
| `cost-report.py` | metrics/ | 문서당 토큰·모델가중 비용 리포트 |
| `transcribe.py` | meeting-minutes/scripts | 녹음 전사 (로컬/OpenAI) — ffmpeg 정규화·청크·타임스탬프 |
| `apikey.py` | meeting-minutes/scripts | OpenAI 키 해석·키체인 저장·인증 테스트 |

### 5-4. 회의록 파이프라인 — 외부 전송을 코드로 막는다

`meeting-minutes`는 다른 스킬과 성격이 하나 다르다. **오디오를 외부로 보낼지 말지**라는 되돌릴 수 없는 결정을 포함한다.

판정은 회의 성격으로 한다 — 인사·평가·**심사**·계약·개인정보·보안·고객사 기밀은 **로컬 온디바이스**(mlx-whisper), 일반 업무회의·기술 논의·일정 조율만 OpenAI API. **애매하면 로컬**이다. 오분류 비용이 비대칭이기 때문이다: 로컬 오분류는 시간만 더 들지만, OpenAI 오분류는 되돌릴 수 없다(삭제해도 캐시·색인이 남을 수 있다).

이 규칙을 SKILL.md에만 적으면 잊힌다. 그래서 스크립트가 `--confirm-upload` 없이는 openai 백엔드를 **실행 자체를 거부**한다. 플래그를 붙이는 행위가 곧 판정을 마쳤다는 기록이 된다.

```bash
$ transcribe.py --backend openai --input 회의.m4a
openai 백엔드는 오디오를 외부 서버로 전송한다.
민감 회의(인사·평가·심사·계약·개인정보)라면 --backend local 을 쓰라.
exit=1     # 네트워크 호출 0회
```

산출물은 둘로 나뉜다. **전사 원문**은 `raw/meetings/transcripts/`에 근거로 보존하고, **회의록**만 `raw/meetings/`에 남겨 위키로 인제스트한다. 63분 녹음은 2만 자를 넘어 회의록의 가독성을 파괴하고 인제스트 토큰을 낭비한다. 회의록 작성은 `meeting-scribe`에 위임해 메인 컨텍스트가 전사문으로 오염되지 않게 한다.

> **화자 분리는 지원하지 않는다.** Whisper 계열은 "누가 말했는지"를 출력하지 않는다. `meeting-scribe`는 근거(호명·자기소개·역할 명시)가 있을 때만 발언을 귀속하고, 나머지는 화자 없이 기록한다. 심사·평가 회의에서 잘못된 발언 귀속은 내용 누락보다 해롭기 때문이다.

### 5-5. MCP 서버 (`tools/llmwiki-mcp/`) — 볼트 밖 에이전트에서 위키 쓰기

지금까지의 구성요소는 모두 **볼트 안에서 도는 Claude Code**를 전제한다. 그런데 위키를 가장 쓰고 싶은 순간은 대개 볼트 밖이다 — 다른 저장소에서 코드를 고치는 중, Codex CLI로 작업하는 중, Cursor에서 문서를 쓰는 중. `tools/llmwiki-mcp/`는 그 간극을 메우는 **읽기 전용 MCP 서버**(Node ≥20, TypeScript)다. 7.5장의 리트리벌 파이프라인(렉시컬 seed → 관계 1홉 확장 → MoC 멤버 → 옵션 BM25 rerank → claims 팩)을 도구 4개(`wiki_expand`·`wiki_pack`·`wiki_read_page`·`wiki_search`)로 노출해, Claude Code(타 프로젝트)·Codex·Gemini·agy·Cursor·Windsurf·Claude Desktop·VS Code 8종이 같은 바이너리를 등록해 쓴다. 등록 스니펫은 `npx obsidian-llmwiki-mcp print-config --client <c> --root <볼트>`가 생성한다.

```bash
claude mcp add --scope user llmwiki -- npx -y obsidian-llmwiki-mcp --root <볼트>
```

**Python 스크립트가 여전히 정본이다.** 볼트 안 `wiki-query`·`wiki-ops`는 무변경 — 계속 `search.py`·`scope-expand.py`를 직접 호출한다. TS는 그 포팅이고, 동일성은 `tests/parity.py`(픽스처 14질의 × 4모드 stdout 바이트 비교 — CI에서 3 OS 매트릭스로 돌고, `--vault`로 실볼트 비교)가 지키고, `tests/parity_fuzz.py`(차등 퍼징, 로컬)가 골든셋 사각지대를 좁힌다. 그래서 규칙 하나가 따라온다:

> **리트리벌 규칙을 바꾸면 Python 스크립트·TS 포팅·패리티 픽스처 3점을 한 PR에서 함께 고친다.** 한쪽만 고치면 CI 패리티 잡이 막는다.

서버는 쓰기 API가 0개다(CI가 `src/`의 `fs.*` 멤버를 허용목록으로 검사). 인제스트·파일링·린트는 계속 볼트 하네스의 일이고, MCP는 **읽기**만 한다.

**설치·사용법(한국어)** — 준비물, 3분 빠른 시작, 클라이언트 8종 등록, 사용법, 환경변수, 문제 해결, 업데이트·제거 — 은 [`tools/llmwiki-mcp/docs/install-and-usage.ko.md`](tools/llmwiki-mcp/docs/install-and-usage.ko.md)에 따로 정리했다. npm 패키지는 [`obsidian-llmwiki-mcp`](https://www.npmjs.com/package/obsidian-llmwiki-mcp)(설치되는 명령은 `llmwiki-mcp`).

영문 상세 레퍼런스(8종 등록 매트릭스·도구 계약·상한·한계·제거 절차)는 [`tools/llmwiki-mcp/README.md`](tools/llmwiki-mcp/README.md), 설계·검토 기록은 `develop_docs/v0.8.6/`에 있다.

---

## 6. 사용법 — 5가지 오퍼레이션

모든 작업의 진입점은 **`wiki-ops`** 오케스트레이터다. 위키 관련 요청을 하면 자동 트리거되고, 알맞은 전문가로 라우팅한다. 자연어로 요청하면 된다.

### 6-1. Ingest (소스 인제스트)

**언제:** 새 소스를 위키에 넣을 때.

```
1. raw/ 에 소스 파일을 넣는다 (예: raw/attention-is-all-you-need.md)
   — Obsidian Web Clipper로 웹 기사를 markdown으로 저장하면 편하다.
2. Claude Code에서: "raw/attention-is-all-you-need.md 인제스트해줘"
```

**LLM이 하는 일 (v2.1 lazy — 싸고 빠르게):**
1. 소스 읽기 (본문 immutable) + 유형 판별 (공식/코드/일반/구두) + 중복 스탬프 체크
2. **기존 개념은 `concept-index.py` 카탈로그로만 파악** (페이지 본문 Read 안 함 — 위키가 커도 O(1))
3. `wiki/L2-episodic/source-*.md` 증거 페이지 — 핵심 사실 전부 `claim::`로 (재등장 신호)
4. **신규 개념만** `wiki/L3-semantic/` 초안 생성 (confidence 0.6 고정). 기존과 겹치면 손대지 않음
5. 신규 L3만 MoC에 가볍게 편입 + `index.md`·`log.md` + raw 맨 위 스탬프
6. 신규 페이지·claim 수 보고 + "병합·신뢰도·관계·승격은 다음 lint 배치" 명시

> **왜 lazy?** v2는 인제스트마다 기존 페이지를 전수 Read하고 병합·관계까지 해서 위키가 클수록 토큰이 O(n)로 폭증했다. v2.1은 인제스트를 증거 남기기로 가볍게 하고, 병합은 본질적으로 효율적인 **누적 후 lint 배치**로 옮겼다(→ [§6-5](#6-5-consolidate-기억-통합), [§7](#7-v2-메커니즘-상세)).

### 6-2. Query (질의)

**언제:** 위키에 질문하거나 비교·분석이 필요할 때.

```
"우리 스택에서 PostgreSQL을 왜 쓰지? 근거랑 신뢰도까지"
"transformer와 RNN 비교표 만들어줘"
```

**LLM이 하는 일:**
1. `index.md` → 관련 MoC → L3 페이지 탐색 (없으면 `search.py`)
2. `confidence`·`status`·`last_confirmed` 확인
3. **stale 페이지는 주근거로 안 씀** (superseded_by 따라 현재 페이지로)
4. 각 주장에 **신뢰도 + 출처 인용** 병기
5. 재사용 가치 있는 답은 **위키에 환류** 제안 → 승인 시 L3에 저장 (탐색이 복리로 쌓임)

### 6-3. Lint (건강 검진)

**언제:** 주기적으로, 또는 SessionStart 훅이 "3일+ 경과" 알릴 때.

```
"위키 점검해줘"  /  "위키 린트"
```

**LLM이 하는 일 (6단계):**
1. **스크립트:** `link-audit.py`(끊긴 링크·고아) + `decay.py`(망각 보존율)
2. **망각 처리:** faded(R<0.3) 페이지 → 재확인 또는 아카이브 후보 (자동 삭제 금지)
3. **신뢰도·supersession 감사:** confidence 정합, stale 짝 링크 확인
4. **통합 승격:** L2→L3, L3→L4 후보 제안
5. **추론 검사:** 모순, 낡은 주장, 누락 개념, 빠진 관계
6. **보고:** 심각도 정렬 수리 목록 + 새 질문·소스 제안

> lint 후 반드시 `## [날짜] lint | ...`를 log에 남긴다 — 자동화 훅이 경과일을 이 항목으로 계산한다.

### 6-4. MoC (네비게이션 정리)

**언제:** 주제 지도를 만들거나 갱신할 때.

```
"llmops 관련 MoC 만들어줘"  /  "네비게이션 정리해줘"
```

**LLM이 하는 일:** `wiki/moc/{topic}-moc.md` 허브 생성/갱신, `home-moc` 계층 유지, 새 L3/L4 페이지 편입, 모든 L3/L4 페이지가 ≥1 MoC에서 도달 가능한지 점검(고아 방지).

### 6-5. Consolidate (기억 통합)

**언제:** 세션 마무리 시(L1→L2), 또는 lint 중(L2→L3→L4).

```
"세션 마무리하자"  /  "L1 압축해줘"  /  "통합해줘"
```

**LLM이 하는 일:**
- **L1→L2:** L1 관찰 3–5줄 압축 → `session-YYYY-MM-DD.md` → L1 비움
- **L2→L3:** 같은 주장 3회+ → `fact-*.md` 승격 (모순 시 보류)
- **L3→L4:** 같은 절차 2회+ → `procedure-*.md` 추출
- **배치 병합 (lazy 인제스트 후속, v2.1):** lazy가 미룬 일을 lint에서 일괄 — 신규 개념 ↔ 기존 페이지 병합, `sources:` 추가·**신뢰도 재계산**(claim 재등장 카운트), `## 관계` 구조화, 중복 초안 정리. 병합은 여러 소스가 쌓인 뒤 한 번에 보는 게 효율적(소스마다 전수 스캔 회피).

---

## 6.5 일상 응용 시나리오 (단순 Q&A를 넘어)

단순 질문은 이 위키의 일부만 쓴다. 핵심 가치는 **인제스트→축적→복리**. 하루 업무 3블록 + 주간 리뷰에 매핑한 응용방안(외부 PKM/LLM-wiki 사례 리서치 기반).

### ① 회의 → 회의록 파이프라인
- **회의 직후 인제스트** → action item·결정사항을 claim으로 자동 추출.
- **회의 전 3분 브리핑** — "이 안건 지난 논의 뭐였지?" → 질의유형 라우팅으로 즉답(빠른 사실브리핑).
- **결정 로그(ADR)** — 결정 번복 시 supersession(`status: stale` + `superseded_by`)으로 "왜 바꿨나" 이력 보존.

### ② 학습 → 지식 복리 + 자동 복습
- **아티클/강의 인제스트** → concept 페이지 축적(흩어진 북마크 대신 연결된 지식).
- **신뢰도(confidence)로 이해도 추적** — 1소스 0.6="얕게 봄", 3소스 0.95="여러 각도 확인".
- **망각(forgetting)이 복습 엔진** — 보존율 하락 시 lint가 "복습 대상" 표시(Ebbinghaus). 일반 PKM엔 없는 기능.

### ③ 개발 → 운영지식·트러블슈팅 축적
- **트러블슈팅 로그** — 장애·해결 인제스트 → 같은 절차 2회+ 시 **L4 procedure 자동 승격**(런북화).
- **기술결정 기록** — "왜 X 대신 Y" concept + supersession.
- **운영지식(llmops·모니터링)** — entity/procedure로 축적.

### ④ 주간 리뷰 (최고 ROI)
완료·미결(open loops)·stale·다음주 우선순위를 한 장으로 종합 → "몇 시간→몇 분". `weekly-review` 스킬로 자동화(`/weekly-review`, 금요일). 회고·계획·상급자 보고 초안을 한 번에.

### 이 위키만의 차별점 (일반 Notion+AI 대비)
| 기능 | 일상 용도 |
|---|---|
| 질의유형 라우팅 | 회의 전 3분 브리핑(빠름) |
| confidence | 보고 신뢰도·이해도 추적 |
| forgetting | 자동 복습 큐(학습) |
| supersession | 결정 번복 이력(ADR) |
| L3→L4 승격 | 반복 절차→런북 |
| session 압축 | 매일 작업 로그 자동 |

> 참고: Karpathy LLM Wiki(지식=컴파일된 코드) · AI Second Brain(회의노트→action item·주간리뷰 자동화) · living knowledge base. 상세 매핑은 위키 페이지 `concept-wiki-daily-usage`.

---

## 7. v2 메커니즘 상세

> **v2.1 타이밍 주의:** 아래 신뢰도·덮어쓰기·관계는 **개념**이고, v2.1에서는 인제스트가 아니라 **lint 배치 시점**에 계산·구조화된다(lazy). 인제스트는 신규 개념에 confidence 0.6만 고정으로 붙이고, 재계산·병합·관계는 미룬다.

### 7-1. 신뢰도 점수 (Confidence)

주장의 확실성을 0.0~1.0으로. **소스 수·유형에서 결정적으로 계산** (`confidence.py`).

| 조건 | 점수 |
|------|------|
| 소스 1개 | 0.60 |
| 소스 2개 | 0.85 |
| 소스 3개 이상 | 0.95 |
| 소스 0개 (미확인) | 0.30 |
| **+** 공식 문서/코드 포함 | +0.10 |
| **−** 구두 정보(slack/회의록) | −0.10 |

최종값은 [0.0, 1.0]로 클램프. L3/L4 페이지 frontmatter `confidence:`에 기록하고, 질의 답변에 병기한다.

```bash
python3 .claude/skills/wiki-consolidate/scripts/confidence.py --count 3 --official   # → 1.0
python3 .claude/skills/wiki-consolidate/scripts/confidence.py --kinds official,normal,verbal   # → 0.95
```

### 7-2. 덮어쓰기 (Supersession)

새 정보가 옛 정보와 **다르면 삭제하지 않고 명시 대체**:
- 옛 페이지: `status: stale` + `superseded_by: [[새-페이지]]`
- 새 페이지: `supersedes: [[옛-페이지]]`
- 서로 링크, 타임스탬프 기록 → **이력 보존**

> 어느 쪽이 맞는지 불명한 **단순 상충**은 대체가 아니라 `> [!warning] 상충` 콜아웃으로 두 출처를 병기한다.

### 7-3. 망각 (Forgetting) — Ebbinghaus 곡선

시간이 지나면 정보의 보존율이 지수적으로 감쇠한다. 재확인하면 리셋.

**보존율** `R = exp(−Δt / S)` — Δt = 마지막 확인 후 경과일, S = 안정성(decay_class가 결정).

| decay_class | S(일) | 성격 |
|-------------|-------|------|
| architecture | 365 | 핵심 설계 결정 — 천천히 망각 |
| procedure | 365 | L4 절차 — 오래 감 |
| concept / semantic | 120 | 의미 개념 |
| entity | 90 | 엔티티 |
| episodic | 21 | 세션·소스 기록 — 바램 |
| transient | 7 | 일시적 버그·일회 관찰 — 빠르게 망각 |
| (default) | 90 | |

**보존율 밴드:** R≥0.5 fresh / 0.3≤R<0.5 aging(재확인 권장) / R<0.3 **faded**(아카이브 후보 — **자동 삭제 금지**).

**리셋:** 재확인 시 `last_confirmed: 오늘` → Δt=0 → R=1.0.

lint가 `decay.py --scan`으로 faded 페이지를 표시한다.

### 7-4. 통합 계층 (Consolidation Tiers)

[2-2장](#2-2-4계층-기억-memory-tiers--v2-핵심) 참조. 요지: **반복·시간·신뢰도로 정보를 차등**. 자주 확인되는 것은 위로 올라가 오래 살고(L4 절차), 한 번 스친 것은 아래에서 망각된다(L1/transient). 사람 기억이 그렇게 작동한다.

### 7-5. 엔티티 관계 (Entity Relations)

엔티티 페이지 `## 관계` 섹션에 **구조화된 관계**를 기록 (Obsidian 인라인 필드 `::` — Dataview 질의 가능):

```markdown
## 관계
- caused :: [[incident-x]] (sources: 3, confidence: 0.9)
- depends_on :: [[postgres]] (sources: 1, confidence: 0.6)
- fixed :: [[bug-123]] (sources: 2, confidence: 0.85)
```

관계 유형: `uses` · `depends_on` · `contradicts` · `caused` · `fixed` · `supersedes`. 각 관계에 소스 수·신뢰도 병기.

### 7-6. 자동화 (Automation)

**정직한 한계:** Claude Code 훅은 **셸만 실행** — LLM lint를 스스로 못 돌린다. 그래서 훅은 **조건 검사 + 알림**까지만 한다.

**두 개의 훅** (`.claude/settings.json`):

1. **SessionStart 훅** — `wiki-status-check.py`
   - 세션 시작 시 1회 실행 (Stop 훅은 매 턴 발화 = 스팸이라 회피)
   - `lint-due.py`로 마지막 lint 3일+ 경과 또는 L1 미압축 감지
   - 해당 시 모델 컨텍스트에 알림 주입 → Claude가 능동으로 lint/consolidate 제안
   - 아무것도 안 걸리면 `{}` (조용)

2. **PostToolUse 훅** — `updated:` 스탬프
   - `Write|Edit`로 `.md` 파일을 건드리면 frontmatter `updated:`를 오늘로 자동 갱신

**진짜 자율 백그라운드 lint**를 원하면 → Claude Code `/schedule` (클라우드 크론 에이전트)로 별도 배선. 예: "매주 월요일 위키 lint 돌려줘".

---

## 7.5 질의 리트리벌 최적화 (v0.8.4~v0.9.0)

질의 응답이 질의당 52~62k 토큰을 쓰던 문제(index 통독 + 광역 MoC 스윕)를 **결정적 그래프 스코프 + 질의유형 라우팅**으로 최적화했다. A/B 9라운드 실측·매 릴리즈 외부감사(agy). 상세: `develop_docs/v0.8.3/TECH-SUMMARY.md`, `develop_docs/v0.8.5/COMBO.md`, 실측 원장 `metrics/ab-results.csv`.

### 핵심 이동
```
[구식]  질의 → index(218줄) 통독 → MoC 다수 → 페이지 12~19 full-read → 종합
[신식]  질의 → scope-expand.py(0토큰): lexical seed → 관계 1홉 확장 → (rerank) → claims 팩
       → synthesizer: 팩 1-read → 부족분만 full-read → 종합
```

### 적용 기술과 근거자료
| 기술 | 근거 | 우리 구현 |
|---|---|---|
| **그래프 확장 스코프** | GraphRAG — 지식그래프 엣지 탐색 | `scope-expand.py expand`: `[[링크]]` 파싱, lexical seed→관계 1홉(아웃·인·MoC멤버). 순수 lexical이 못 닿는 관계연결 페이지 도달 |
| **claims 컨텍스트 팩** | Parent-Document Retriever(small-to-big) | 팩(claims)=small-side, 페이지 full=parent. 팩 1-read로 다중 페이지 대체 |
| **질의유형 라우팅** | Adaptive-RAG(질의복잡도 라우팅) | 조회=seed·사실브리핑=rerank+팩·절차=full-read. 하나의 전략은 만능 아님 |
| **BM25 rerank** | Anthropic Contextual Retrieval(reranking 실패 49→67%↓) | 임베딩 없이 BM25(0토큰)로 확장 pool을 질의관련도 top-N 축소 |
| **팩에 관계 포함** (v0.8.6) | 관계질의=관계 실린 사실브리핑 | pack이 `## 관계`(uses/depends_on) 줄도 추출(+300토큰). 관계타겟(connector 등)을 새 라우트 없이 커버 |

> 요약: **우리 claims 팩 = parent-retriever의 small-side였고, rerank·라우팅이 빠진 조각**이었다. Adaptive-RAG로 질의유형을 나누고, Contextual Retrieval의 reranking을 BM25로 얹어 완성.

### 질의유형별 라우팅 (파라미터)
| 유형 | 스코프 명령 | 전달 |
|---|---|---|
| 단일조회 | `scope-expand.py expand … --max 6` | seed 목록 |
| 사실브리핑·비교 | `… --max 20 --rerank 11` | claims 팩 |
| 절차·how-to | `… --max 8`(rerank 안 함) | 후보 full-read(팩 없음) |

### 실측 결과 (동일조건 A/B)
| 질의유형 | 구식(baseline) | 신식 | 개선 |
|---|---|---|---|
| **사실브리핑** | 50.6k / 14 tool | 22.7k / 1 tool | **토큰 −55%·tool −93%** |
| **절차·how-to** | 39.5k / 8 | ~38k / 10 | 동률(절차는 스코핑 이득 없음 — 본질적으로 다페이지 세부 필요) |

### 교훈 (실측 검증)
- **관계 도달은 lexical로 안 됨** → 그래프 1홉 확장 필수.
- **팩은 사실질의에만 이득** → 절차질의는 full-read 라우팅.
- **rerank는 최대 레버지만 다이얼** → 조이면 싸지고 recall 준다(11이 균형).
- **recall의 진짜 레버는 `--max`가 아니라 키워드 품질**(엔티티 포함).
- **절차질의 비용은 근본적** → 스코핑으로 못 줄임. 반복비용은 환류 캐시(query 페이지)로만.
- **관계질의는 새 유형 아님** → 팩에 관계 실으면 사실브리핑 라우트로 커버.

> 전체 근거자료·구현 상세·A/B 원장: `develop_docs/v0.8.3/TECH-SUMMARY.md`. 관련 리서치 — [GraphRAG](https://microsoft.github.io/graphrag/) · [Parent-Document Retriever](https://python.langchain.com/v0.2/docs/how_to/parent_document_retriever/) · [Adaptive-RAG](https://arxiv.org/pdf/2502.00409) · [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) · Contextual Compression · Self-RAG · Stop-RAG · AB-RAG.

---

## 8. Frontmatter 스키마 레퍼런스

모든 위키 페이지 상단에 YAML frontmatter. **파일이 `type:`을 가져야 위키 페이지로 인식**된다(스크립트가 CLAUDE.md 같은 비-페이지를 걸러냄).

```yaml
---
type: working | episodic | session | source | fact | entity | concept | procedure | moc | index | log | query
title: <한국어 제목>
aliases: []                  # 영문 파일명의 한국어 라벨/별칭
tags: []                     # 소문자, 예: [llm, training]
created: YYYY-MM-DD
updated: 2026-09-09

# --- L3/L4 전용 (신뢰도·망각) ---
confidence: 0.0~1.0          # confidence.py로 계산
sources: [소스-슬러그, …]     # 근거 소스 (개수가 신뢰도 결정)
last_confirmed: YYYY-MM-DD    # 재확인마다 갱신 → 망각 리셋
decay_class: architecture | procedure | concept | entity | episodic | transient
status: active | stale        # 대체된 정보는 stale (삭제 안 함)
superseded_by: [[새-페이지]]   # (옛 페이지에) 대체됨
supersedes: [[옛-페이지]]      # (새 페이지에) 대체함

# --- source 페이지 전용 ---
source_url: <URL 또는 raw 경로>
source_kind: official | code | normal | verbal
---
```

**raw 파일 인제스트 스탬프** (raw/ 원본 맨 위에만 추가 — 본문 무변경, 완료 표시·중복 방지):
```yaml
---
ingested: YYYY-MM-DD
wiki_source: [[source-<slug>]]   # 생성된 L2 증거 페이지
ingest_status: done
---
```
raw 본문은 immutable이지만 이 상태 스탬프는 예외. `ingest-status.py`가 이 표시로 done/pending을 판별한다.

**규약 요약:**
- 본문 한국어, 파일명 영문 kebab-case (`[[wikilinks]]` 깔끔)
- `[[wikilinks]]` 양방향, 없는 페이지 링크는 스텁으로 남김
- 모든 L3/L4 페이지는 ≥1 MoC 도달 가능 (고아 방지)
- 소스 immutable, 충돌은 병기 또는 supersession
- 파일 이동·이름변경은 승인 후 (wikilink 깨짐)

---

## 9. 스크립트 레퍼런스

### confidence.py
```bash
# 소스 수 + 유형으로 신뢰도 계산
python3 .claude/skills/wiki-consolidate/scripts/confidence.py --count 2                    # 0.85
python3 .claude/skills/wiki-consolidate/scripts/confidence.py --count 1 --official         # 0.7
python3 .claude/skills/wiki-consolidate/scripts/confidence.py --kinds official,normal      # count=2, +official → 0.95
python3 .claude/skills/wiki-consolidate/scripts/confidence.py --count 3 --json             # {"score":0.95,...}
```
소스 유형: `official`|`code`(+0.1) · `verbal`(−0.1) · `normal`.

### decay.py
```bash
# 단일 페이지 보존율
python3 .claude/skills/wiki-lint/scripts/decay.py --class architecture --last 2026-01-01   # "0.57 fresh"
python3 .claude/skills/wiki-lint/scripts/decay.py --class transient --last 2026-07-01       # "0.04 faded"
# 위키 전체 스캔 — faded/aging 페이지 나열
python3 .claude/skills/wiki-lint/scripts/decay.py --scan . --json
```
`--today YYYY-MM-DD`로 기준일 지정 가능(기본 오늘). `last_confirmed` 없으면 `updated:` 사용.

### link-audit.py
```bash
python3 .claude/skills/wiki-lint/scripts/link-audit.py .           # 사람이 읽는 리포트
python3 .claude/skills/wiki-lint/scripts/link-audit.py . --json    # {broken, orphans, ...}
```
- **broken:** 대상 페이지가 없는 `[[wikilink]]` ((page,target) 중복 제거)
- **orphans:** inbound 링크 0인 페이지 (단, index/log/working/episodic/session/source 유형은 제외 — 정상적으로 inbound 0)
- **stub_targets:** 없는 페이지를 가리키는 링크를 **참조 페이지 수(inbound)순**으로 집계 → 여러 페이지가 가리키는 스텁 = 누락 개념 **최우선 작성 후보**. (의도된 스텁과 오타 broken을 구분하는 신호)
- HTML 주석·코드펜스 안의 링크는 무시. `type:` 있는 파일만 페이지로 취급.

### lint-due.py
```bash
python3 .claude/skills/wiki-lint/scripts/lint-due.py . 3      # 임계 3일
# 출력: "DUE 5" | "OK 2" | "NEVER"  +  "L1:<미압축 페이지 수>"
```
`log.md`의 마지막 `## [날짜] lint` 항목으로 경과일 계산.

### wiki-status-check.py
SessionStart 훅이 호출. `lint-due.py` 결과로 알림 JSON을 만든다. DUE거나 L1>0이면 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`, 아니면 `{}`.

### search.py
```bash
python3 .claude/skills/wiki-lint/scripts/search.py "transformer"      # wiki/ 전체 grep (rg 미의존)
```

### list-claims.py
```bash
python3 .claude/skills/wiki-consolidate/scripts/list-claims.py .      # L2-episodic의 claim:: 라인 수집
```
같은 주장이 3회+ 등장하는지 LLM이 클러스터링하는 입력(배치 병합·승격).

### concept-index.py
```bash
python3 .claude/skills/wiki-ingest/scripts/concept-index.py .         # 기존 L3/L4 카탈로그
# 출력: slug | title | aliases | confidence  (frontmatter만, 한 줄씩)
```
lazy 인제스트의 핵심 — 45개 페이지 본문을 Read하는 대신 이 한 출력만 보고 개념이 **기존인지 신규인지** 판별한다(토큰 O(1) 유지).

### cost-report.py
```bash
python3 metrics/cost-report.py                # 문서당 토큰·페이지 효율 표
python3 metrics/cost-report.py --by-model     # opus vs sonnet 비교 (모델가중 wcost)
```
`metrics/ingest-cost.csv`(오케스트레이터가 인제스트마다 append)를 읽어 tok/page·모델가중 비용을 낸다. v2/v2.1 비용대비효과 추적용. MODEL_PRICE 상대단가 opus 5·sonnet 1·haiku 0.25.

### ingest-status.py
```bash
python3 .claude/skills/wiki-lint/scripts/ingest-status.py .           # raw/ 인제스트 상태
# 출력: DONE <date> <file> | PENDING <file>  +  "ingested: N   pending: M"
```
raw 파일 맨 위 스탬프(`ingest_status: done`)를 읽어 인제스트 완료/대기를 판별. **raw 본문은 immutable — 스탬프는 맨 위 메타 블록만 추가**(본문 무변경). Obsidian에서 각 소스에 완료 표시가 보이고, 중복 인제스트를 막는다. `wiki_source` 필드는 생성된 L2 증거 페이지로 클릭 이동. 미인제스트 소스는 SessionStart 훅도 알린다.

> **환경 주의:** 스크립트는 **grep·python3만** 의존한다. `rg`(ripgrep)는 비로그인 셸 PATH에 없는 경우가 많아 쓰지 않는다.

---

## 10. Obsidian 설정 팁

- **Web Clipper** — 브라우저 확장. 웹 기사를 markdown으로 변환해 `raw/`에 빠르게 저장.
- **이미지 로컬 다운로드** — Settings → Files and links → Attachment folder path를 `raw/assets/`로. Settings → Hotkeys에서 "Download attachments for current file"을 단축키(예: Ctrl+Shift+D)로 바인딩. 클리핑 후 눌러 이미지 로컬 저장 → LLM이 이미지를 직접 참조 가능(끊기는 URL 대신).
  - 단, LLM은 인라인 이미지가 섞인 md를 한 번에 못 읽는다 — 텍스트 먼저 읽고, 필요한 이미지만 별도로 본다.
- **그래프 뷰** — 위키 형태(허브·고아)를 보는 최고의 도구.
- **Dataview 플러그인** — frontmatter(confidence·tags·sources·관계 `::`)로 동적 테이블·리스트 생성.
- **Marp 플러그인** — 위키 내용에서 슬라이드 덱 직접 생성.
- **git** — 위키는 결국 markdown git 레포. 버전 이력·브랜치·협업 무료.

### 템플릿 (회의록·오늘의 노트)

`templates/`에 두 템플릿이 있다. Obsidian 코어 플러그인으로 연결한다.

**회의록 — `templates/meeting.md` → `raw/meetings/`**
- 성격: 회의는 **구두 소스**(`source_kind: verbal`) — 인제스트 시 신뢰도 −0.1.
- 섹션: 안건 / 논의·결정 / 액션. frontmatter=메타(date·attendees), 본문=내용, 파일명=제목(중복 없음).
- 연결: 설정 → 코어 플러그인 **Templates** 켜기 → 템플릿 폴더 `templates` → 새 노트에서 `Cmd+P` → "Insert template" → meeting.
- 흐름: 회의 중 기록 → `raw/meetings/`에 저장 → "인제스트해줘" → 결정·액션이 위키에 통합(`ingest-status`가 자동으로 pending 감지).

**오늘의 노트 — `templates/daily.md` → `raw/notes/`**
- 성격: 개인 **스크래치**(할 일·배운 것). 지식이 아니라 타임라인 → 인제스트해도 **L2-episodic 기록만**, L3 개념 생성 안 함.
- 섹션: 할 일 / 한 일·배운 것 / 메모. 파일명=날짜.
- 연결: 설정 → 코어 플러그인 **Daily notes** 켜기 → New file location `raw/notes` · Template file location `templates/daily` · Date format `YYYY-MM-DD` → 달력 아이콘/"Open today".
- 주의: `raw/notes/`는 인제스트 pending 스캔에서 **제외**돼 있다(매일 노트가 알림을 시끄럽게 안 만들게). 특정 날 노트를 위키에 넣고 싶으면 수동 인제스트.

> **동적 템플릿**: 날짜 자동·참석자 입력이 필요하면 **Templater** 커뮤니티 플러그인. `{{date}}` → `<% tp.date.now("YYYY-MM-DD") %>`, 입력받기 `<% tp.system.prompt("제목") %>`. 폴더 템플릿으로 `raw/meetings/`·`raw/notes/`에 새 노트 만들 때 자동 적용도 가능.

---

## 11. 하네스 진화·확장

하네스는 정적 산출물이 아니라 **진화하는 시스템**이다.

- **피드백 반영 경로:**
  | 피드백 유형 | 수정 대상 |
  |------------|----------|
  | 결과물 품질 | 해당 에이전트의 스킬 (`.claude/skills/*/SKILL.md`) |
  | 에이전트 역할 | 에이전트 정의 (`.claude/agents/*.md`) |
  | 워크플로우 순서 | 오케스트레이터 (`wiki-ops/SKILL.md`) |
  | 트리거 누락 | 스킬 description |
  | 신뢰도 규칙 | `confidence.py` (base_for·모디파이어) |
  | 망각 속도 | `decay.py` STABILITY 딕셔너리 |
  | 승격 임계 | `wiki-consolidate/SKILL.md` (3회/2회) |

- **모든 변경은 [`CHANGELOG.md`](CHANGELOG.md)(하네스 변경 이력)에 기록** — 하네스가 어떻게 진화했는지 추적, 퇴행 방지. (2026-09-11 에 `CLAUDE.md` 에서 분리 — CLAUDE.md 는 현재 규칙만 둔다)
- **재-myharness:** 큰 아키텍처 변경은 `/myharness:myharness`에 개선안을 넘겨 자동 확장. `update` 인자로 팩토리 정본 변경을 빌드된 하네스에 재전파(사용자 수정 보존).

**튜닝 예시 — 망각을 더 느리게:**
```python
# .claude/skills/wiki-lint/scripts/decay.py 의 STABILITY 수정
STABILITY = { "architecture": 730, ... }   # 365 → 730일
```

---

## 12. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| SessionStart 알림이 안 뜬다 | 세션 중 추가된 훅을 watcher가 미로드 | Claude Code에서 `/hooks` 한 번 열기 또는 재시작 |
| `updated:` 자동 스탬프 안 됨 | 위와 동일 (훅 미로드) | `/hooks` 열기 |
| 스크립트 "command not found: rg" | 비로그인 셸 PATH에 rg 없음 | 이미 grep 기반이라 무관 — 커스텀 스크립트 추가 시 rg 대신 grep 사용 |
| `link-audit.py`가 CLAUDE.md를 고아로 잡음 | 구버전 | 최신 버전은 `type:` 없는 파일 제외 — 스크립트 갱신 |
| 볼트가 비어 보임 (파일 없음) | OneDrive 클라우드 미동기 | Finder에서 "이 기기에 항상 유지" 또는 OneDrive 동기 강제 |
| 위키 페이지가 검색 안 됨 | frontmatter `type:` 누락 | 모든 페이지에 `type:` 부여 (스크립트가 페이지 판별 기준으로 씀) |
| decay.py가 페이지를 스캔 안 함 | `last_confirmed`·`updated` 둘 다 없음 | frontmatter에 날짜 필드 추가 |

**검증 명령 모음:**
```bash
# 링크 정합
python3 .claude/skills/wiki-lint/scripts/link-audit.py .
# 스크립트 문법
for s in $(find .claude/skills -name '*.sh'); do bash -n "$s"; done
for p in $(find .claude/skills -name '*.py'); do python3 -m py_compile "$p"; done
# 훅 JSON 유효성
jq -e '.hooks' .claude/settings.json
```

---

## 13. 설계 결정 요약

| 결정 | 이유 |
|------|------|
| 전문가 풀(서브 에이전트), 팀 아님 | 오퍼레이션은 서로 다른 시점에 1명씩 실행 — 동시 협업 불필요. 인제스트는 단일 에이전트가 통째로(교차참조 일관성) |
| 계산은 스크립트, 판단은 LLM | 링크·신뢰도·망각은 결정적 → 스크립트가 공짜로. LLM 예산은 의미 검사(모순·승격 동치)에만 |
| grep 기반 스크립트 | rg는 비로그인 셸 PATH에 없는 경우가 많음 |
| SessionStart 훅 (Stop 아님) | Stop은 매 턴 발화=스팸. SessionStart는 세션당 1회 |
| 훅은 알림까지만 | 훅은 셸만 실행 — LLM lint 자동 실행 불가. 진짜 자율은 /schedule |
| stale 마킹, 삭제 안 함 | 이력 보존 — 언제 무엇이 왜 바뀌었는지 추적 |
| 단일 런타임 (Claude Code) | Codex 미사용 — AGENTS.md/.codex 중복 동기 부담 회피 |
| index.md + MoC 병존 | index=전수(기계적), MoC=큐레이션(계층). 임베딩 RAG 없이 수백 페이지 항해 |
| **lazy 인제스트 (v2.1)** | 인제스트는 증거+신규초안만, 병합·신뢰도·관계·승격은 lint 배치로. eager는 위키 클수록 O(n) 토큰 폭증 — 병합은 누적 후 일괄이 효율적 |
| **모델 라우팅 (v2.1)** | 인제스트=sonnet(기계적·빈번), 나머지=opus(고추론). 측정 페이지당 실질비용 ~4.6×↓·지연 ~3×↓ |
| **비용 원장 (v2.1)** | `metrics/` — 문서당 토큰·모델가중 비용 추적. 최적화 효과를 숫자로 검증 |
| raw/notes 스캔 제외 | 데일리 노트는 스크래치 — 매일 pending 알림 스팸 방지, 넣고 싶은 날만 수동 인제스트 |

---

## 부록 — 빠른 시작 (TL;DR)

```
1. Obsidian 볼트 생성, Claude Code를 볼트에서 실행
2. /hooks 한 번 열어 훅 로드
3. raw/ 에 첫 소스 넣기 (Web Clipper 추천)
4. "이 소스 인제스트해줘"  → L2 증거 + L3 사실(신뢰도) 생성
5. "llmops MoC 만들어줘"   → 네비게이션 지도
6. "위키에 ~ 질문"         → 신뢰도 포함 인용 답변
7. "위키 린트"             → 망각·모순·승격 점검
8. "세션 마무리"           → L1→L2 압축
9. Obsidian 그래프 뷰로 위키 형태 브라우징
```

> **현재 상태는 `CLAUDE.md`(스키마), 하네스 변경 이력은 [`CHANGELOG.md`](CHANGELOG.md), 위키 타임라인은 `log.md` 가 정본이다.**
