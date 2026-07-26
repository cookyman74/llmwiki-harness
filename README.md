# LLM Wiki — Obsidian 볼트를 LLM이 유지보수하는 지식 베이스로 운영하기

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
7. [v2 메커니즘 상세](#7-v2-메커니즘-상세)
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
    ├── agents/                # 전문가 정의 (누가) — 5개
    │   ├── wiki-ingestor.md        (model: sonnet)
    │   ├── wiki-synthesizer.md
    │   ├── wiki-linter.md
    │   ├── wiki-cartographer.md
    │   └── wiki-consolidator.md
    └── skills/                # 워크플로우 정의 (어떻게)
        ├── wiki-ops/          # ★ 오케스트레이터 (진입점)
        ├── wiki-ingest/       # 인제스트 절차 (lazy)
        │   └── scripts/       # concept-index.sh
        ├── wiki-query/        # 질의 절차
        ├── wiki-lint/         # 점검 절차
        │   └── scripts/       # link-audit.py, decay.py, lint-due.sh, search.sh,
        │                      # ingest-status.sh, wiki-status-check.sh
        ├── wiki-moc/          # MoC 절차
        └── wiki-consolidate/  # 통합·배치병합 절차
            └── scripts/       # confidence.py, list-claims.sh
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
- **python3** (스크립트 — 신뢰도·망각·링크 감사 계산; macOS 기본 탑재)
- **grep, jq, awk** (셸 스크립트 — 대부분 OS 기본)
- (선택) **Obsidian** — 위키를 사람이 브라우징. 그래프 뷰로 위키 형태를 본다.
- **rg(ripgrep) 불필요** — 스크립트는 rg가 비로그인 셸 PATH에 없는 경우가 많아 **grep 기반**으로 작성됨.

---

## 5. 하네스 구성요소

핵심 설계: **에이전트(누가) + 스킬(어떻게) 분리.** 에이전트는 역할·원칙·프로토콜을, 스킬은 절차·템플릿을 담는다.

**실행 모드: 전문가 풀 (서브 에이전트 디스패치).** 오퍼레이션마다 전문가 **1명**을 호출한다 — 동시 협업 팀이 아니다. 한 소스 인제스트는 교차참조·신뢰도 일관성을 위해 **단일 에이전트**가 통째로 처리한다(분할하면 페이지 충돌).

### 5-1. 에이전트 (5명)

| 에이전트 | 역할 | 사용 스킬 | 모델 |
|----------|------|-----------|------|
| **wiki-ingestor** | 소스 인제스트 (lazy) — L2 증거 + **신규 L3 초안만**. 병합·신뢰도·덮어쓰기·관계는 lint 배치로 지연 | wiki-ingest, wiki-moc | **sonnet** |
| **wiki-synthesizer** | 질의 응답 — index→MoC→L3 탐색, 신뢰도·최신성 반영 인용 답변, 환류 | wiki-query, wiki-moc | opus |
| **wiki-linter** | 건강 검진 — 링크·망각·신뢰도 감사, 승격 후보, 모순 검사 | wiki-lint, wiki-consolidate, wiki-moc | opus |
| **wiki-cartographer** | MoC 네비게이션 — 허브 생성·갱신, L3/L4 편입, 도달성 점검 | wiki-moc | opus |
| **wiki-consolidator** | 기억 통합 — L1→L2 압축, L2→L3→L4 승격, 신뢰도 재계산 + **lazy 후속 배치 병합**(기존 페이지 통합·관계 구조화·중복 초안 정리) | wiki-consolidate, wiki-moc | opus |

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

### 5-2. 스킬 (6개)

| 스킬 | 유형 | 하는 일 |
|------|------|---------|
| **wiki-ops** | 오케스트레이터 (진입점) | Phase 0 컨텍스트 확인 → 라우팅 → 오퍼레이션 흐름 조율 |
| **wiki-ingest** | 워크플로우 | (lazy) 소스 → L2 증거 + 신규 L3 초안 (병합·신뢰도·관계·승격은 lint 지연) |
| **wiki-query** | 워크플로우 | 탐색 → 신뢰도 반영 인용 답변 → 환류 |
| **wiki-lint** | 워크플로우 | 스크립트 검사 → 망각·신뢰도·supersession 감사 → 배치 승격 → 추론 검사 |
| **wiki-moc** | 워크플로우 | MoC 허브 구조·계층·편입·도달성 |
| **wiki-consolidate** | 워크플로우 | 4계층 승격 (L1→L2→L3→L4) + **lazy 후속 배치 병합**(신뢰도·관계·기존 통합) |

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
| `list-claims.sh` | wiki-consolidate/scripts | L2 주장(claim::) 수집 → 배치 병합·승격 |
| `concept-index.sh` | wiki-ingest/scripts | 기존 L3/L4 카탈로그 (본문 Read 없이 신규/기존 판별 — lazy의 핵심) |
| `decay.py` | wiki-lint/scripts | Ebbinghaus 망각 보존율 계산·스캔 |
| `link-audit.py` | wiki-lint/scripts | 끊긴 wikilink + 고아 + 누락 타겟(stub_targets) |
| `lint-due.sh` | wiki-lint/scripts | 마지막 lint 경과일 + L1 미압축 수 |
| `ingest-status.sh` | wiki-lint/scripts | raw 인제스트 상태 (done/pending) |
| `wiki-status-check.sh` | wiki-lint/scripts | SessionStart 훅 — lint 경과·L1·미인제스트 알림 |
| `search.sh` | wiki-lint/scripts | grep 기반 위키 본문 검색 |
| `cost-report.py` | metrics/ | 문서당 토큰·모델가중 비용 리포트 |

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
2. **기존 개념은 `concept-index.sh` 카탈로그로만 파악** (페이지 본문 Read 안 함 — 위키가 커도 O(1))
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
1. `index.md` → 관련 MoC → L3 페이지 탐색 (없으면 `search.sh`)
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

1. **SessionStart 훅** — `wiki-status-check.sh`
   - 세션 시작 시 1회 실행 (Stop 훅은 매 턴 발화 = 스팸이라 회피)
   - `lint-due.sh`로 마지막 lint 3일+ 경과 또는 L1 미압축 감지
   - 해당 시 모델 컨텍스트에 알림 주입 → Claude가 능동으로 lint/consolidate 제안
   - 아무것도 안 걸리면 `{}` (조용)

2. **PostToolUse 훅** — `updated:` 스탬프
   - `Write|Edit`로 `.md` 파일을 건드리면 frontmatter `updated:`를 오늘로 자동 갱신

**진짜 자율 백그라운드 lint**를 원하면 → Claude Code `/schedule` (클라우드 크론 에이전트)로 별도 배선. 예: "매주 월요일 위키 lint 돌려줘".

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
updated: YYYY-MM-DD           # 편집 시 갱신 (PostToolUse 훅이 자동 스탬프)

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
raw 본문은 immutable이지만 이 상태 스탬프는 예외. `ingest-status.sh`가 이 표시로 done/pending을 판별한다.

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

### lint-due.sh
```bash
bash .claude/skills/wiki-lint/scripts/lint-due.sh . 3      # 임계 3일
# 출력: "DUE 5" | "OK 2" | "NEVER"  +  "L1:<미압축 페이지 수>"
```
`log.md`의 마지막 `## [날짜] lint` 항목으로 경과일 계산.

### wiki-status-check.sh
SessionStart 훅이 호출. `lint-due.sh` 결과로 알림 JSON을 만든다. DUE거나 L1>0이면 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`, 아니면 `{}`.

### search.sh
```bash
bash .claude/skills/wiki-lint/scripts/search.sh "transformer"      # wiki/ 전체 grep (rg 미의존)
```

### list-claims.sh
```bash
bash .claude/skills/wiki-consolidate/scripts/list-claims.sh .      # L2-episodic의 claim:: 라인 수집
```
같은 주장이 3회+ 등장하는지 LLM이 클러스터링하는 입력(배치 병합·승격).

### concept-index.sh
```bash
bash .claude/skills/wiki-ingest/scripts/concept-index.sh .         # 기존 L3/L4 카탈로그
# 출력: slug | title | aliases | confidence  (frontmatter만, 한 줄씩)
```
lazy 인제스트의 핵심 — 45개 페이지 본문을 Read하는 대신 이 한 출력만 보고 개념이 **기존인지 신규인지** 판별한다(토큰 O(1) 유지).

### cost-report.py
```bash
python3 metrics/cost-report.py                # 문서당 토큰·페이지 효율 표
python3 metrics/cost-report.py --by-model     # opus vs sonnet 비교 (모델가중 wcost)
```
`metrics/ingest-cost.csv`(오케스트레이터가 인제스트마다 append)를 읽어 tok/page·모델가중 비용을 낸다. v2/v2.1 비용대비효과 추적용. MODEL_PRICE 상대단가 opus 5·sonnet 1·haiku 0.25.

### ingest-status.sh
```bash
bash .claude/skills/wiki-lint/scripts/ingest-status.sh .           # raw/ 인제스트 상태
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

- **모든 변경은 `CLAUDE.md`의 "변경 이력" 테이블에 기록** — 하네스가 어떻게 진화했는지 추적, 퇴행 방지.
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

> **변경 이력·현재 상태는 항상 `CLAUDE.md`(스키마)와 `log.md`(타임라인)가 정본이다.**
