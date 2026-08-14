# 백엔드 설치 · 옵션 · 키 관리 상세

SKILL.md가 필요할 때만 읽는 참조 문서.

## 목차
1. 로컬 백엔드 설치
2. OpenAI 백엔드 모델 선택
3. API 키 저장 방식 비교
4. 화자 분리 (미지원 · 우회)
5. 옵션 레퍼런스

---

## 1. 로컬 백엔드 설치

### Apple Silicon (권장)

```bash
python3 -m pip install mlx-whisper
```

Apple의 MLX 프레임워크로 통합 메모리와 GPU를 쓴다. M 시리즈에서 `faster-whisper`(CPU)보다 3~5배 빠르다.

첫 실행 시 `mlx-community/whisper-large-v3-turbo`(약 1.5GB)를 HuggingFace에서 받아 `~/.cache/huggingface/`에 캐시한다. 이후 실행은 다운로드가 없다.

### 그 외 플랫폼

```bash
python3 -m pip install faster-whisper
```

CPU에서 CTranslate2로 동작한다. `--model large-v3`가 정확하지만 느리다. 한국어는 `medium` 이하에서 고유명사·직함이 자주 깨지므로 회의록 용도로는 `large-v3`를 권한다.

### 모델별 특성 (한국어 회의 기준)

| 모델 | 크기 | 33분 소요(M시리즈) | 비고 |
|---|---|---|---|
| `whisper-large-v3-turbo` | 1.5GB | 5~8분 | **기본값.** 정확도/속도 균형 |
| `whisper-large-v3` | 3GB | 12~20분 | 고유명사가 중요한 회의 |
| `whisper-medium` | 1.5GB | 4~6분 | 초안용. 직함·사명 오인식 잦음 |

교체: `--model mlx-community/whisper-large-v3`

---

## 2. OpenAI 백엔드 모델 선택

| 모델 | 타임스탬프 | 한국어 정확도 | 언제 |
|---|---|---|---|
| `whisper-1` | **세그먼트 단위(수 초)** | 보통 | **기본값** |
| `gpt-4o-transcribe` | 청크 단위(기본 10분) | 높음 | 고유명사·수치가 중요하고 시점 인용은 덜 중요할 때 |

`whisper-1`이 기본인 이유는 정확도가 아니라 **타임스탬프 해상도** 때문이다. `gpt-4o-transcribe`는 텍스트만 반환해서 청크 하나가 통째로 한 블록이 되고, 그러면 회의록의 `[12:34]` 인용이 청크 내 모든 항목에서 같은 값으로 뭉개진다. 전사문을 "원문 확인 진입점"으로 쓰는 설계가 무너지고, 로컬 백엔드(세그먼트 반환)와 산출물 형태도 어긋난다.

정확도를 우선해야 하면 `--model gpt-4o-transcribe`로 바꾸되, `--chunk-min 5`를 함께 주면 타임스탬프 손실이 절반으로 줄어든다.

25MB 제한 때문에 정규화 후에도 큰 파일은 청크로 나눈다. 기본 10분, `--chunk-min 5`로 줄일 수 있다. 청크 경계에서 문장이 잘릴 수 있으니, 경계 부근 내용이 중요하면 `--chunk-min`을 바꿔 재실행해 대조하라.

---

## 3. API 키 저장 방식 비교

| 방식 | 암호화 | 프로세스 노출 | 동기화 위험 | 권장도 |
|---|---|---|---|---|
| **macOS 키체인** | ✅ | 요청 시에만 | 없음 | **권장** |
| `~/.config/llmwiki/secrets.json` (0600) | ❌ | 파일 읽기 시 | 낮음 | 키체인 없는 OS |
| `OPENAI_API_KEY` 환경변수 | ❌ | **모든 자식 프로세스** | 없음 | 일회성·CI |
| 셸 프로필(`.zshrc`)에 export | ❌ | 모든 프로세스 | dotfiles 백업 시 유출 | 비권장 |
| 볼트 안 `security.json` | ❌ | 파일 읽기 시 | **OneDrive 동기화·git** | 금지 |
| `~/Downloads/security.json` | ❌ | 파일 읽기 시 | 정리 도구가 삭제·실수 공유 | 레거시 |

### 키체인 사용

```bash
python3 scripts/apikey.py set-keychain     # 대화형 입력
echo "sk-..." | python3 scripts/apikey.py set-keychain   # 파이프
python3 scripts/apikey.py status           # 어디서 읽히는지 확인
python3 scripts/apikey.py test             # 실제 인증 + 모델 접근 확인
```

내부적으로 `security add-generic-password -s llmwiki-openai -a $USER` 를 쓴다. 직접 확인:

```bash
security find-generic-password -s llmwiki-openai -w   # 키 출력
security delete-generic-password -s llmwiki-openai    # 삭제
```

Keychain Access.app에서 `llmwiki-openai`로 검색하면 GUI로도 보인다.

> [!warning] 저장 순간의 노출
> `security add-generic-password -w <키>`는 키를 인자로 넘기므로 **실행되는 수백 밀리초 동안 `ps` 출력에 보인다.** 셸 히스토리에는 남지 않는다(스크립트가 셸을 거치지 않고 argv 리스트로 실행). 같은 머신에 신뢰할 수 없는 사용자가 있으면 키체인 GUI(Keychain Access.app)로 직접 등록하라 — service `llmwiki-openai`, account는 `$USER`.

### 레거시 파일 정리 시 주의

`~/Downloads/security.json`은 `tts`·`gpt-image2` 스킬도 참조한다. `migrate`는 복사만 하고 원본을 지우지 않는다. 원본을 지우려면 그 스킬들의 키 해석 경로를 먼저 옮겨야 한다 — 각 스킬의 `resolve_key()`가 `OPENAI_API_KEY` 환경변수를 먼저 보므로, 셸 프로필 대신 다음처럼 키체인에서 주입하는 래퍼를 쓰면 파일 없이도 동작한다.

```bash
OPENAI_API_KEY=$(security find-generic-password -s llmwiki-openai -w) python3 <스킬 스크립트>
```

### 볼트 커밋 안전성

`.gitignore`가 `raw/**`를 제외하므로 녹음·전사문·회의록은 커밋되지 않는다. 다만 **키 파일을 볼트 안에 두지 마라** — `security.json`이 루트에 있으면 gitignore 대상이 아니고 OneDrive로도 동기화된다.

---

## 4. 화자 분리 (미지원)

Whisper 계열은 "누가 말했는지"를 구분하지 않는다. 전사문은 발언 순서대로 이어진 하나의 흐름이다.

회의록 작성 시 대응:
- 발언 내용·직함 언급·맥락으로 화자를 **추정하되, 추정임을 표시**한다. 회의록에 잘못된 발언 귀속은 사실 오류보다 위험하다.
- 참석자를 알면 `meeting-scribe`에게 명단을 넘긴다. 추정 정확도가 올라간다.
- 정확한 귀속이 꼭 필요하면 `pyannote.audio`(HuggingFace 토큰 필요) 파이프라인을 별도 구성해야 한다. 현재 스킬 범위 밖이다.

실무적으로는 **결정사항과 액션아이템에만 화자를 붙이고**, 논의 과정은 화자 없이 요약하는 편이 오류가 적다.

---

## 5. 옵션 레퍼런스

```
--backend {local,openai}   필수
--input FILE [FILE...]     여러 개면 한 회의의 연속 녹음으로 처리
--out-dir DIR              기본 raw/meetings/transcripts
--language CODE            기본 ko. 영어 회의는 en
--model NAME               백엔드별 기본값 교체
--chunk-min N              OpenAI 청크 길이(분). 기본 10
--api-key KEY              일회성 키 주입
--confirm-upload           openai 백엔드 필수 플래그
--check                    백엔드 가용성만 점검하고 종료
```

`--check` 출력 예:

```
=== 백엔드 가용성 ===
  ✓ ffmpeg
  ✓ ffprobe
  ✓ local  (mlx-whisper)
  ✓ openai (macOS 키체인 (llmwiki-openai))
```
