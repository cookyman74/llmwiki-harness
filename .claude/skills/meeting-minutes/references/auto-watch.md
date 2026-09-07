# 녹음 자동 감지 — 어디까지 자동화하고 어디서 멈추는가

## 결론

**감지·알림은 자동, 전사 백엔드 판정과 회의록 작성은 사람.** 이 경계는 편의 문제가 아니라 되돌릴 수 없는 결정을 사람이 쥐게 하려는 설계다.

| 단계 | 자동화 | 이유 |
|---|---|---|
| 새 녹음 감지 | ✅ SessionStart 훅 | 결정이 없다. 세는 일이다 |
| 미처리 상태 판정 | ✅ `pending-recordings.py` | frontmatter 참조로 결정적 판정 |
| **백엔드 선택(로컬/외부)** | ❌ **사람** | 되돌릴 수 없다. 오판 비용 비대칭 |
| 전사 실행 | △ 로컬 한정으로만 가능 | 아래 참조 |
| **회의록 작성** | ❌ **사람과 함께** | 회의 성격·참석자·맥락을 파일명으로 알 수 없다 |

## 왜 전면 자동화를 하지 않는가

**① 백엔드 판정은 파일명으로 못 한다.**
`Recording 20260828105125.m4a`라는 이름에 "이건 심사 회의다"라는 정보가 없다. 실제로 이 파일은 공모전 수상작 결정 회의였고 `sensitivity: confidential`이었다. 자동 규칙이 이름만 보고 openai로 보냈다면 심사위원 발언이 외부로 나갔을 것이고, 전송은 되돌릴 수 없다.

**② 일일노트 맥락도 못 믿는다.**
같은 날 일일노트의 메모는 `lll` 한 줄이었다. 사람이 아직 안 적었을 뿐인데, 자동화는 "맥락 없음 = 일반 회의"로 읽기 쉽다.

**③ 사람 메모가 전사보다 우선이다.**
SKILL.md Phase 4의 원칙 — *"사람이 적어둔 요점이 회의록에서 빠졌으면 사람 메모가 우선이다. 전사는 발언을 담지만 판단을 담지 못한다."* 무인 실행은 대조할 사람 메모가 아직 없는 시점에 돌아간다.

## 지금 작동하는 것 — SessionStart 감지

`wiki-status-check.py`가 `pending-recordings.py`를 호출해 세션 시작 시 알린다.

```
미처리 녹음 6건 (Recording 20260821144937.m4a, …) — 회의록 미작성.
`meeting-minutes`로 처리 권장. **백엔드는 회의 성격에 따라 사람이 판정**하므로
자동 전사하지 않는다 — 사용자에게 회의 성격을 물어볼 것.
```

훅 메시지 자체가 "물어보라"고 지시하므로, 모델이 임의로 전사를 시작하지 않는다.

## 선택 — 로컬 전사 사전 실행 (파일 감시)

전사는 47분 녹음에 10~15분 걸린다. 이 대기를 없애고 싶다면 **로컬 백엔드 한정으로** OS 레벨 감시를 걸 수 있다. 로컬은 네트워크 호출이 0회라 무인 실행해도 데이터가 나가지 않는다 — 자동화해도 안전한 유일한 구간이다.

`~/Library/LaunchAgents/com.llmwiki.recwatch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.llmwiki.recwatch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd "$VAULT" && python3 .claude/skills/meeting-minutes/scripts/watch-transcribe.py</string>
  </array>
  <key>WatchPaths</key>
  <array><string>REPLACE_WITH_VAULT/raw/assets</string></array>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
```

`watch-transcribe.py`는 아직 없다. 만든다면 반드시 아래를 지킨다.

- `--backend local` **하드코딩**. `--confirm-upload`를 코드에 넣지 않는다
- 이미 전사문이 있으면 건너뛴다(재전사는 비싸다)
- 파일 크기가 안정될 때까지 대기(녹음 중 파일에 손대지 않는다)
- **회의록은 만들지 않는다.** 전사문까지만
- 실패해도 조용히 끝낸다(무인 실행이 사용자를 방해하지 않는다)

이 구성이면 세션을 열 때 상태가 `TRANSCRIBED`가 되어 있고, 남는 일은 회의록 작성뿐이다 — 대기 없이 바로 대화로 넘어간다.

**설치 전 확인:** 이건 세션과 무관하게 상주하는 시스템 변경이다. 볼트가 OneDrive 동기화 폴더라 다른 기기에서 내려온 파일에도 반응한다는 점을 감안할 것.
