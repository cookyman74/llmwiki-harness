#!/usr/bin/env python3
"""합성 픽스처 볼트 생성기 (v0.8.6 P0-19~P0-31).

실 볼트 콘텐츠를 절대 포함하지 않는다 — 가상의 "Northwind" 검색 플랫폼을 주제로 한 합성 페이지.
BOM·CRLF·non-BMP 같은 바이트 수준 케이스를 에디터가 훼손하지 않도록 생성기를 정본으로 둔다.

Usage:
  python3 make-fixture.py            # test/fixtures/vault/ 에 생성(덮어쓰기)
  python3 make-fixture.py --check    # 생성 결과와 디스크가 동일한지 검사(exit 1 = 불일치)

케이스 대응(DESIGN §7 / P0 체크리스트):
  P0-20 BOM              → L3-semantic/concept-evaluation-harness.md
  P0-21 CRLF             → L3-semantic/concept-prompt-caching-crlf.md (.gitattributes -text)
  P0-22 별칭 전용 링크    → concept-linker → [[별칭페이지]] → concept-alias-target
  P0-23 이미지 임베드     → entity-northwind-team  ![[diagram.png]]
  P0-24 펜스 안 가짜 관계  → concept-reranking 코드펜스
  P0-25 펜스 안 claim::  → concept-reranking 코드펜스 (claims에는 포함되어야 함)
  P0-26 non-BMP          → concept-emoji-notes 본문, slug zz-🦀-crab / zz-￦-won
  P0-27 claim 없는 페이지 → entity-northwind-team (첫 실문단 요약)
  P0-28 stale/superseded → fact-latency-budget-old ↔ fact-latency-budget
  P0-29 중복 slug        → L2-episodic/dup-note.md, L3-semantic/dup-note.md
  P0-30 큰 MoC(10+)      → moc/search-moc.md
  P0-31 한국어 관계 술어   → entity-northwind-search  - 사용함 :: [[…]]
  추가: type 없는 페이지(부모 디렉터리명 기본값) → L4-procedural/procedure-no-type.md
  추가: wiki/ 밖 index.md — 전 키워드 포함, 스코프 제외 검증
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "vault")

FM = "---\ntype: {type}\ntitle: {title}\naliases: {aliases}\ntags: [fixture]\ncreated: 2026-09-01\nupdated: 2026-09-09\n{extra}---\n"


def fm(type_, title, aliases="[]", **extra):
    ex = "".join(f"{k}: {v}\n" for k, v in extra.items())
    return FM.format(type=type_, title=title, aliases=aliases, extra=ex)


PAGES = {}  # relpath(under wiki/) -> bytes


def add(rel, text, bom=False, crlf=False):
    if crlf:
        text = text.replace("\n", "\r\n")
    data = text.encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    PAGES[rel] = data


# ---------------- L3-semantic (15) ----------------
add("L3-semantic/concept-vector-index.md", fm("concept", "벡터 인덱스", "[벡터 인덱스, vector index]", confidence="0.85", sources="[northwind-kickoff, latency-review]", status="active") + """
# 벡터 인덱스

- claim:: 벡터 인덱스는 임베딩을 근사 최근접 탐색 구조로 저장한다.
- claim:: Northwind 검색은 HNSW 벡터 인덱스를 기본으로 쓴다.

벡터 인덱스를 만들기 전에 [[concept-chunking]]으로 문서를 나눈다. 결과는 [[concept-reranking]]으로 재순위한다.

## 관계
- depends_on :: [[concept-chunking]] (sources: 2, confidence: 0.85)
- used_by :: [[entity-northwind-search]]
""")

add("L3-semantic/concept-chunking.md", fm("concept", "청킹", "[chunking, 청킹]", confidence="0.6", sources="[northwind-kickoff]") + """
# 청킹

- claim:: 청킹(chunking)은 문서를 검색 단위로 자르는 전처리다.
- claim:: Northwind는 512토큰 청킹을 기본값으로 쓴다.

청킹 크기는 [[concept-vector-index]] 품질과 [[fact-latency-budget]]에 함께 영향을 준다.
""")

add("L3-semantic/concept-reranking.md", fm("concept", "재순위", "[rerank, 재순위, reranking]", confidence="0.85", sources="[latency-review, search-briefing]") + """
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
""")

add("L3-semantic/entity-northwind-search.md", fm("entity", "Northwind 검색 서비스", "[Northwind Search, 노스윈드 검색]", confidence="0.95", sources="[northwind-kickoff, latency-review, search-briefing]", decay_class="entity") + """
# Northwind 검색 서비스

- claim:: Northwind 검색 서비스는 사내 문서 검색 플랫폼이다.
- claim:: 검색 파이프라인은 청킹 → 벡터 인덱스 → rerank 순서다.

운영 주체는 [[entity-northwind-team]]이다.

## 관계
- 사용함 :: [[concept-chunking]] (sources: 3, confidence: 0.95)
- 사용함 :: [[concept-vector-index]]
  - uses :: [[concept-reranking]]
- owned_by :: [[entity-northwind-team]]
""")

add("L3-semantic/entity-northwind-team.md", fm("entity", "Northwind 팀", "[노스윈드 팀]", confidence="0.6", sources="[northwind-kickoff]", decay_class="entity") + """
# Northwind 팀

![[diagram.png]]

> 이 페이지는 claim:: 형식을 쓰지 않는다 — 요약 경로 검증용.

| 역할 | 인원 |
|---|---|
| 검색 | 3 |

Northwind 팀은 검색 플랫폼의 팀 구성과 운영을 맡는 가상의 조직이다.

두 번째 문단은 요약에 포함되지 않아야 한다. 팀 구성은 분기마다 바뀐다.
""")

add("L3-semantic/fact-latency-budget.md", fm("fact", "검색 지연 예산", "[레이턴시 예산, latency budget]", confidence="0.85", sources="[latency-review, search-briefing]", supersedes="\"[[fact-latency-budget-old]]\"", last_confirmed="2026-09-05") + """
# 검색 지연 예산

- claim:: 검색 end-to-end 지연 예산은 800ms다.
- claim:: rerank 단계에 배정된 지연은 150ms다.

이 사실은 [[fact-latency-budget-old]]를 대체한다.

## 관계
- supersedes :: [[fact-latency-budget-old]]
""")

add("L3-semantic/fact-latency-budget-old.md", fm("fact", "검색 지연 예산 (구)", "[]", confidence="0.6", sources="[northwind-kickoff]", status="stale", superseded_by="\"[[fact-latency-budget]]\"") + """
# 검색 지연 예산 (구)

- claim:: 검색 end-to-end 지연 예산은 1200ms다.

> [!warning] 상충 — [[fact-latency-budget]]로 대체됨.
""")

add("L3-semantic/concept-evaluation-harness.md", fm("concept", "평가 하네스", "[evaluation harness, 평가 harness]", confidence="0.6", sources="[search-briefing]") + """
# 평가 하네스

- claim:: 평가 harness는 골든셋 질의로 recall과 precision을 측정한다.

BOM이 앞에 붙은 파일이다(P0-20). [[concept-reranking]] 품질 평가에 쓰인다.
""", bom=True)

add("L3-semantic/concept-prompt-caching-crlf.md", fm("concept", "프롬프트 캐싱", "[prompt caching, 프롬프트 캐싱]", confidence="0.6", sources="[latency-review]") + """
# 프롬프트 캐싱

- claim:: prompt 캐싱은 반복 접두 토큰의 재계산을 줄여 지연을 낮춘다.
- claim:: Northwind는 시스템 프롬프트 캐싱으로 지연을 약 30% 줄였다.

CRLF 줄바꿈 파일이다(P0-21). [[fact-latency-budget]] 안에서 절감분을 계산한다.
""", crlf=True)

add("L3-semantic/concept-emoji-notes.md", fm("concept", "이모지 노트", "[emoji notes]", confidence="0.6", sources="[session-2026-09-01]") + """
# 이모지 노트 🦀🚀

- claim:: 이모지 🦀 같은 non-BMP 문자는 문서 길이 계산에서 코드포인트 1개로 센다.

정렬테스트 키워드를 포함한다. 🚀🚀🚀 문자열 길이가 UTF-16과 코드포인트에서 다르다.
""")

add("L3-semantic/zz-🦀-crab.md", fm("concept", "크랩 노트", "[]", confidence="0.6", sources="[session-2026-09-01]") + """
# 크랩

정렬테스트 — non-BMP(U+1F980) slug. 코드포인트 순서에서는 ￦(U+FFE6) 뒤에 온다.
""")

add("L3-semantic/zz-￦-won.md", fm("concept", "원화 노트", "[]", confidence="0.6", sources="[session-2026-09-01]") + """
# 원화

정렬테스트 — BMP 상위(U+FFE6) slug. UTF-16 코드유닛 비교에서는 🦀 뒤로 밀린다.
""")

add("L3-semantic/concept-alias-target.md", fm("concept", "별칭 대상 페이지", "[별칭페이지, AliasName, 'quoted alias']", confidence="0.6", sources="[session-2026-09-01]") + """
# 별칭 대상 페이지

- claim:: 이 페이지는 slug가 아닌 별칭으로만 링크된다.

별칭페이지 본문. 다른 페이지가 [[별칭페이지]] 또는 [[AliasName|표시]]로 가리킨다.
""")

add("L3-semantic/concept-linker.md", fm("concept", "링커", "[]", confidence="0.6", sources="[session-2026-09-01]") + """
# 링커

- claim:: 링커 페이지는 별칭 링크·표시 텍스트 링크·섹션 링크를 모두 쓴다.

[[별칭페이지]] 와 [[AliasName|표시 텍스트]] 와 [[concept-vector-index#관계]] 로 연결한다. 자기 자신 [[concept-linker]]도 링크한다(제외 검증).
""")

add("L3-semantic/concept-uppercase-term.md", fm("concept", "GraphRAG 메모", "[GraphRAG]", confidence="0.6", sources="[search-briefing]") + """
# GraphRAG

- claim:: GraphRAG는 그래프 구조를 리트리벌에 쓰는 기법이다.

대문자 질의 매칭 검증용. GraphRAG GraphRAG.
""")

add("L3-semantic/dup-note.md", fm("concept", "중복 슬러그 (L3)", "[]", confidence="0.6", sources="[session-2026-09-01]") + """
# 중복 슬러그 — L3 버전

- claim:: 중복 slug는 walk 순서상 마지막 파일이 이긴다 — 이 파일(L3-semantic)이 승자여야 한다.
""")

# ---------------- L2-episodic (5) ----------------
add("L2-episodic/source-northwind-kickoff.md", fm("source", "Northwind 킥오프 회의", "[]", ingested="2026-09-01") + """
# Northwind 킥오프

- claim:: 킥오프에서 청킹 512토큰과 HNSW 벡터 인덱스를 결정했다.
- claim:: 초기 지연 예산은 1200ms로 잡았다.

관련: [[entity-northwind-search]] [[concept-chunking]] [[fact-latency-budget-old]]
""")

add("L2-episodic/source-latency-review.md", fm("source", "지연 리뷰 회의", "[]", ingested="2026-09-05") + """
# 지연 리뷰

- claim:: 지연 예산을 800ms로 낮추고 rerank에 150ms를 배정했다.
- claim:: prompt 캐싱으로 30% 절감을 확인했다.

관련: [[fact-latency-budget]] [[concept-reranking]] [[concept-prompt-caching-crlf]]
""")

add("L2-episodic/session-2026-09-01.md", fm("session", "세션 2026-09-01", "[]") + """
# 세션 2026-09-01

- 픽스처 볼트 설계. 별칭·이모지·중복 slug 케이스를 넣기로 함.
- [[concept-alias-target]] [[concept-emoji-notes]] [[dup-note]]
""")

add("L2-episodic/dup-note.md", fm("episodic", "중복 슬러그 (L2)", "[]") + """
# 중복 슬러그 — L2 버전

- claim:: 이 파일은 L2-episodic에 있으며 walk 순서상 먼저 읽혀 덮어써져야 한다.
""")

add("L2-episodic/query-search-briefing.md", fm("query", "검색 파이프라인 브리핑 2026-09-07", "[]", decay_class="episodic") + """
# 검색 파이프라인 브리핑

- claim:: 2026-09-07 시점 Northwind 검색은 청킹→벡터 인덱스→rerank 구조이며 지연 예산 800ms다.

근거: [[entity-northwind-search]] [[fact-latency-budget]] [[concept-reranking]] [[concept-uppercase-term]] [[concept-evaluation-harness]]
""")

# ---------------- L4-procedural (2) ----------------
add("L4-procedural/procedure-deploy-index.md", fm("procedure", "인덱스 배포 절차", "[]", confidence="0.85", sources="[northwind-kickoff, latency-review]") + """
# 인덱스 배포 절차

- claim:: 인덱스 배포는 청킹 → 임베딩 → 벡터 인덱스 빌드 → 스모크 질의 순서다.

## steps
1. [[concept-chunking]] 설정 확인
2. [[concept-vector-index]] 빌드
3. [[concept-evaluation-harness]]로 골든셋 질의
""")

add("L4-procedural/procedure-no-type.md", "---\ntitle: type 없는 절차\naliases: []\ntags: [fixture]\ncreated: 2026-09-01\nupdated: 2026-09-09\n---\n" + """
# type 없는 절차

- claim:: frontmatter에 type이 없으면 부모 디렉터리명(L4-procedural)이 type이 된다.

[[procedure-deploy-index]] 참고.
""")

# ---------------- moc (3) ----------------
add("moc/home-moc.md", fm("moc", "홈") + """
# 홈

- [[search-moc]]
- [[team-moc]]
""")

add("moc/search-moc.md", fm("moc", "검색 MoC") + """
# 검색 MoC (멤버 12 — MEMBER_K=6 소프트 컷 검증)

Northwind 검색 관련 페이지 지도.

- [[concept-vector-index]]
- [[concept-chunking]]
- [[concept-reranking]]
- [[entity-northwind-search]]
- [[fact-latency-budget]]
- [[fact-latency-budget-old]]
- [[concept-evaluation-harness]]
- [[concept-prompt-caching-crlf]]
- [[concept-uppercase-term]]
- [[procedure-deploy-index]]
- [[query-search-briefing]]
- [[concept-linker]]
""")

add("moc/team-moc.md", fm("moc", "팀 MoC") + """
# 팀 MoC

- [[entity-northwind-team]]
- [[entity-northwind-search]]
- [[session-2026-09-01]]
""")

# wiki/ 밖 — 스코프 제외 검증 (모든 키워드 포함)
OUTSIDE = {
    "index.md": "# index (wiki/ 밖 — 스코프 제외)\n\n벡터 인덱스 청킹 rerank 정렬테스트 별칭페이지 GraphRAG 캐싱 평가 harness 팀 구성 northwind 검색 레이턴시 지연 ZZZNOPE\n",
    "log.md": "# log\n\n## [2026-09-09] fixture | 합성 볼트 생성\n",
}


def build():
    out = {}
    for rel, data in PAGES.items():
        out[os.path.join(ROOT, "wiki", rel)] = data
    for rel, text in OUTSIDE.items():
        out[os.path.join(ROOT, rel)] = text.encode("utf-8")
    return out


def main():
    files = build()
    if "--check" in sys.argv:
        bad = []
        for p, data in files.items():
            try:
                with open(p, "rb") as fh:
                    if fh.read() != data:
                        bad.append(p)
            except OSError:
                bad.append(p)
        if bad:
            print("MISMATCH:\n  " + "\n  ".join(os.path.relpath(b, HERE) for b in bad))
            sys.exit(1)
        print(f"fixture OK ({len(files)} files)")
        return
    for p, data in files.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(data)
    print(f"wrote {len(files)} files under {os.path.relpath(ROOT, HERE)}/")


if __name__ == "__main__":
    main()
