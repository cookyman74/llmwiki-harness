#!/usr/bin/env python3
"""OpenAI API key 해석·설정 헬퍼.

키는 평문 파일보다 OS 키체인에 두는 것이 안전하다. 해석 순서는 '명시 > 휘발성 >
암호화 저장 > 평문 파일' — 앞쪽일수록 의도가 명확하고 수명이 짧다.

해석 순서:
  1. --api-key 인자          (일회성·명시)
  2. OPENAI_API_KEY 환경변수  (CI·일회성 셸)
  3. macOS 키체인             (권장 · 암호화 저장)
  4. ~/.config/llmwiki/secrets.json (0600 · 키체인 없는 OS)
  5. ~/Downloads/security.json      (레거시 · tts 스킬 호환)

CLI:
  python3 apikey.py status              현재 어디서 읽히는지 (마스킹 출력)
  python3 apikey.py set-keychain        stdin으로 키 입력 → 키체인 저장
  python3 apikey.py migrate             레거시 파일에서 키체인으로 복사
  python3 apikey.py test                실제 API 호출로 키 유효성 확인
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

KEYCHAIN_SERVICE = "llmwiki-openai"
KEYCHAIN_ACCOUNT = os.environ.get("USER", "default")
CONFIG_PATH = Path.home() / ".config" / "llmwiki" / "secrets.json"
LEGACY_PATHS = (Path.home() / "Downloads" / "security.json",)


def _from_keychain() -> str | None:
    if sys.platform != "darwin":
        return None
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
             "-a", KEYCHAIN_ACCOUNT, "-w"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def _from_config() -> str | None:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    key = data.get("openai_api_key")
    return key.strip() if isinstance(key, str) and key.strip() else None


def _from_legacy() -> str | None:
    for path in LEGACY_PATHS:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for acc in data.get("accounts", []):
            if not isinstance(acc, dict) or acc.get("type") != "api":
                continue
            key = acc.get("api_key")
            if not key:
                continue
            blob = f"{acc.get('name','')}{acc.get('base_url','')}{acc.get('provider','')}".lower()
            if "openai" in blob:
                return key.strip()
    return None


def resolve(explicit: str | None = None) -> tuple[str | None, str]:
    """키와 출처 라벨을 반환한다."""
    if explicit:
        return explicit, "--api-key 인자"
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"], "OPENAI_API_KEY 환경변수"
    key = _from_keychain()
    if key:
        return key, f"macOS 키체인 ({KEYCHAIN_SERVICE})"
    key = _from_config()
    if key:
        return key, str(CONFIG_PATH)
    key = _from_legacy()
    if key:
        return key, f"{LEGACY_PATHS[0]} (레거시)"
    return None, "없음"


def mask(key: str) -> str:
    return f"{key[:7]}…{key[-4:]}" if len(key) > 15 else "…"


def set_keychain(key: str) -> None:
    if sys.platform != "darwin":
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps({"openai_api_key": key}, indent=2), encoding="utf-8")
        CONFIG_PATH.chmod(0o600)
        print(f"키체인 미지원 OS → {CONFIG_PATH} 에 0600 으로 저장했다.")
        return
    subprocess.run(
        ["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
         "-a", KEYCHAIN_ACCOUNT, "-w", key,
         "-l", "llmwiki OpenAI API key",
         "-D", "application password",
         "-j", "meeting-minutes 스킬의 OpenAI 전사용 키"],
        check=True, capture_output=True, text=True,
    )
    print(f"키체인에 저장했다 — service={KEYCHAIN_SERVICE} account={KEYCHAIN_ACCOUNT}")


def cmd_status() -> int:
    key, source = resolve()
    print(f"출처 : {source}")
    print(f"키   : {mask(key) if key else '(없음)'}")
    if not key:
        print("\n설정하려면: python3 apikey.py set-keychain")
        return 1
    if "레거시" in source or "Downloads" in source:
        print("\n⚠️  Downloads 는 임시 폴더다 — 정리 도구가 지우거나 실수로 공유되기 쉽다.")
        print("   python3 apikey.py migrate 로 키체인으로 옮겨라.")
    return 0


def cmd_test(key: str | None = None) -> int:
    key, source = resolve(key)
    if not key:
        print("키 없음. python3 apikey.py set-keychain 먼저 실행하라.")
        return 1
    try:
        from openai import OpenAI
    except ImportError:
        print("openai 패키지 없음: python3 -m pip install openai")
        return 1
    try:
        models = OpenAI(api_key=key).models.list()
        names = {m.id for m in models.data}
    except Exception as exc:  # noqa: BLE001 - 사용자에게 원문 노출이 유용
        print(f"인증 실패 ({source}): {exc}")
        return 1
    print(f"인증 성공 ({source})")
    for want in ("gpt-4o-transcribe", "whisper-1"):
        print(f"  {'✓' if want in names else '✗'} {want}")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        return cmd_status()
    if cmd == "set-keychain":
        key = sys.stdin.read().strip() if not sys.stdin.isatty() else input("OpenAI API key: ").strip()
        if not key.startswith("sk-"):
            print("sk- 로 시작하지 않는다. 잘못 붙여넣은 것 같다.")
            return 1
        set_keychain(key)
        return cmd_test(key)
    if cmd == "migrate":
        key = _from_legacy() or _from_config()
        if not key:
            print("레거시 위치에서 키를 찾지 못했다.")
            return 1
        set_keychain(key)
        print("\n원본 파일은 지우지 않았다 — 다른 스킬(tts·gpt-image2)이 아직 참조할 수 있다.")
        print("그 스킬들을 옮긴 뒤 직접 삭제하라.")
        return 0
    if cmd == "test":
        return cmd_test()
    print(__doc__)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
