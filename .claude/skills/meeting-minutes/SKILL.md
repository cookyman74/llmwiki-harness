---
name: meeting-minutes
description: 음성 녹음(m4a·mp3·wav)을 전사해 회의록 노트로 만든다. 로컬 전사(온디바이스)와 OpenAI API 전사 두 백엔드를 회의 민감도에 따라 선택한다. 트리거 — "녹음 정리/전사", "회의록 만들어", "녹음 내용 정리", "음성 회의록", "transcribe", 일일노트에 `![[Recording *.m4a]]` 첨부, `raw/assets/`에 오디오 추가. 후속 표현도 포함 — "다시 전사", "재실행", "회의록 보완", "액션아이템만 다시", "로컬로 다시 돌려". 텍스트만 있는 회의 메모를 정리하는 작업(녹음 없음)에는 쓰지 않는다 — 그건 wiki-ops 인제스트다.
---

# meeting-minutes

녹음 → 전사문 → 회의록 노트. 산출물은 두 개로 나뉜다.

| 산출물 | 위치 | 성격 |
|---|---|---|
| 전사 원문 | `raw/meetings/transcripts/YYYY-MM-DD-<파일명>.transcript.md` | 기계 출력. 길고 그대로 읽히지 않음 |
| **회의록** | `raw/meetings/YYYY-MM-DD <제목>.md` | 사람이 읽고 위키로 인제스트되는 정본 |

전사문을 회의록에 합치지 않는 이유: 63분 녹음이 2만 자를 넘어 회의록의 가독성을 파괴하고, 인제스트 시 토큰을 낭비한다. 원문은 근거로 보존하되 링크로만 참조한다.

## Phase 0 — 컨텍스트 확인

**미처리 녹음 일람은 스크립트가 준다** (SessionStart 훅이 자동 호출하므로 대개 이미 알고 있다):

```bash
python3 .claude/skills/meeting-minutes/scripts/pending-recordings.py .
#   NEW          전사문 없음           → 전사부터 (백엔드 판정 필요)
#   TRANSCRIBED  전사문 O · 회의록 X    → 회의록만 작성 (전사 재실행 금지)
#   DONE         회의록이 그 녹음 참조   → 완료
```

판정 근거는 파일명 규칙이 아니라 frontmatter의 명시적 참조다 — 전사문의 `source_audio:`, 회의록의 `recording:`. 파일을 옮겨도 연결이 깨지지 않는다.

> **전사·회의록 작성은 자동화하지 않는다.** 훅은 *감지와 알림*까지만 한다. 백엔드 판정(Phase 1)은 되돌릴 수 없는 결정이고 회의 성격은 파일명으로 알 수 없으므로, 반드시 사용자에게 물어본 뒤 진행한다. 무인 자동 전사를 원한다면 `references/auto-watch.md`(로컬 전사 한정) 참조.

1. 대상 오디오를 특정한다. 일일노트의 `![[Recording *.m4a]]` 임베드, `raw/assets/` 최신 파일, 또는 사용자 지정 경로.
2. `raw/meetings/transcripts/`에 같은 파일의 전사문이 이미 있는지 확인한다.
   - **있고 + 회의록 수정 요청** → 전사 건너뛰고 회의록만 재작성 (전사는 비싸다. 재실행 금지)
   - **있고 + 백엔드 변경 요청** → 재전사 후 기존 전사문 덮어씀
   - **없음** → 전사부터
3. `python3 .claude/skills/meeting-minutes/scripts/transcribe.py --check` 로 백엔드 가용성을 먼저 본다.

## Phase 1 — 백엔드 선택 (가장 중요)

**오디오를 외부로 보낼지 말지의 결정이고, 되돌릴 수 없다.** 전송된 데이터는 삭제해도 캐시·색인이 남을 수 있다.

### 판정 규칙

| 회의 성격 | 백엔드 | 이유 |
|---|---|---|
| 인사·평가·징계·급여 협의 | **local** | 개인에 대한 판단이 담김 |
| **심사·채점·수상작 선정** | **local** | 심사위원 발언은 비공개 전제 |
| 계약·법무·소송·감사 | **local** | 법적 분쟁 시 증거로 다뤄짐 |
| 미공개 재무·M&A·인수 | **local** | 내부자 정보 |
| 개인정보·건강·상담 | **local** | 정보주체 동의 없음 |
| 보안 취약점·사고 대응 | **local** | 공격 표면 노출 |
| 고객사 기밀이 오간 회의 | **local** | 제3자 데이터 — 계약 위반 소지 |
| 일반 업무회의·진행상황 공유 | openai | |
| 기술 논의·설계 리뷰 | openai | |
| 일정 조율·업무 분배 | openai | |
| 사내 세미나·교육 | openai | |
| 본인 단독 메모·구술 초안 | openai | 타인 음성 없음 |

### 판정 절차

1. 위 표로 분류한다. 파일명·일일노트 맥락·사용자 발언이 단서다.
2. **애매하면 local**. 오분류 비용이 비대칭이다 — local 오분류는 시간만 더 들지만, openai 오분류는 되돌릴 수 없다.
3. openai로 판정했으면 **실행 전 사용자에게 한 줄로 확인받는다**: "일반 업무회의로 보고 OpenAI로 전사합니다. 민감 내용이 있으면 알려주세요."
4. 참석자 중 **본인 외 타인의 음성이 포함**되고 그들이 외부 전송에 동의한 적 없다면, 표에서 openai여도 local을 우선 제안한다.

> 스크립트는 `--confirm-upload` 없이는 openai 백엔드를 실행하지 않는다. 이 규칙을 프롬프트로만 두면 잊히므로 코드로 강제했다. 플래그를 붙이는 행위 자체가 판정을 마쳤다는 기록이다.

## Phase 2 — 전사 실행

```bash
cd <볼트 루트>
S=.claude/skills/meeting-minutes/scripts

# 민감 → 로컬
python3 $S/transcribe.py --backend local \
  --input "raw/assets/Recording 20260813104144.m4a"

# 일반 → OpenAI (판정 + 사용자 확인 후에만)
python3 $S/transcribe.py --backend openai --confirm-upload \
  --input "raw/assets/Recording 20260813104144.m4a"
```

여러 파일을 `--input a.m4a b.m4a`로 넘기면 한 회의의 연속 녹음으로 처리한다.

- 소요: 로컬은 실시간의 0.15~0.3배(63분 → 10~20분), OpenAI는 2~4분.
- 로컬 첫 실행은 모델 다운로드(~1.5GB)가 선행된다.
- 진행 로그는 stderr, 결과 JSON은 stdout. 실패 시 그 파일만 건너뛰지 않고 중단한다 — 부분 전사는 회의록을 왜곡한다.

옵션은 `references/backend-setup.md` 참조 (모델 교체·타임스탬프 정밀도·청크 크기).

## Phase 3 — 회의록 작성

전사문을 **`meeting-scribe` 에이전트에게 위임**한다. 전사문은 2만 자를 넘어 메인 컨텍스트에 올리면 이후 대화가 오염된다.

```
Agent(subagent_type="meeting-scribe", prompt="
전사문: raw/meetings/transcripts/2026-08-13-Recording 20260813104144.transcript.md
회의 맥락: <일일노트 메모·참석자·목적 등 아는 것>
출력 경로: raw/meetings/2026-08-13 <제목>.md
")
```

에이전트가 없거나 단일 파일이 짧으면(5분 미만) 직접 작성해도 된다.

## Phase 4 — 정리 및 환류

1. 회의록 상단 frontmatter에 `recording`·`transcript`·`backend`가 채워졌는지 확인한다.
2. 일일노트의 기존 수기 메모와 대조한다. 사람이 적어둔 요점이 회의록에서 빠졌으면 **사람 메모가 우선**이다 — 전사는 발언을 담지만 판단을 담지 못한다.
3. 액션아이템이 있으면 일일노트 `## 할 일`에 반영을 제안한다.
4. 위키 인제스트를 제안한다 (`wiki-ops`). 회의록은 L2 증거 페이지로 좋은 소스다.

## API 키 설정

```bash
python3 .claude/skills/meeting-minutes/scripts/apikey.py status        # 현재 출처 확인
python3 .claude/skills/meeting-minutes/scripts/apikey.py set-keychain  # 키체인에 저장
python3 .claude/skills/meeting-minutes/scripts/apikey.py migrate       # 레거시 파일 → 키체인
```

해석 순서는 `--api-key` > `OPENAI_API_KEY` > macOS 키체인 > `~/.config/llmwiki/secrets.json`(0600) > `~/Downloads/security.json`(레거시).

키체인을 권장하는 이유: 암호화 저장이고, 프로세스 환경변수로 새지 않으며, 볼트가 OneDrive로 동기화돼도 따라가지 않는다. 상세는 `references/backend-setup.md`.

## 실패 처리

| 증상 | 원인 | 대응 |
|---|---|---|
| `ffmpeg 없음` | 미설치 | `brew install ffmpeg` |
| `로컬 전사 엔진이 없다` | mlx-whisper 미설치 | `python3 -m pip install mlx-whisper` |
| openai 백엔드가 거부됨 | `--confirm-upload` 누락 | 판정을 다시 하라. 의도적 차단이다 |
| `OpenAI 키 없음` | 키 미설정 | `apikey.py set-keychain` |
| 413 / file too large | 청크 실패 | `--chunk-min 5` 로 낮춤 |
| 전사문이 뒤죽박죽 | 화자 분리 미지원 | Whisper 계열은 화자를 나누지 않는다. `references/backend-setup.md`의 화자 분리 항목 참조 |

## 테스트 시나리오

**정상**: `raw/assets/Recording 20260813104144.m4a`(33분, AI 공모전 **평가** 회의) → 심사 회의이므로 판정 **local** → `--backend local` 실행 → `raw/meetings/transcripts/2026-08-13-Recording 20260813104144.transcript.md` 생성 → `meeting-scribe`가 `raw/meetings/2026-08-13 AI 공모전 최우수상 평가 회의.md` 작성 → 일일노트 수기 메모 4줄이 회의록에 모두 반영됐는지 대조. 검증: 전사문 frontmatter `backend: local`·`sensitivity: confidential`, 회의록에 액션아이템 담당·기한 존재.

**에러**: 같은 파일에 `--backend openai`를 `--confirm-upload` 없이 실행 → 스크립트가 판정 안내와 함께 종료, **네트워크 호출 0회**. 검증: 전사문 미생성, exit code 1.
