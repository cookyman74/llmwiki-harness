#!/usr/bin/env python3
"""음성 녹음 → 타임스탬프 전사문.

백엔드 두 가지:
  local   온디바이스 (mlx-whisper / faster-whisper). 오디오가 기기 밖으로 나가지 않는다.
  openai  OpenAI API. 빠르고 한국어 정확도가 높지만 **오디오가 외부로 전송된다.**

openai 백엔드는 --confirm-upload 없이는 실행되지 않는다. 프롬프트 규칙은 잊히거나
무시될 수 있어서, 되돌릴 수 없는 외부 전송은 코드로 막는다.

사용:
  transcribe.py --backend local  --input a.m4a b.m4a
  transcribe.py --backend openai --input a.m4a --confirm-upload
  transcribe.py --check                      # 백엔드 가용성 점검
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import apikey  # noqa: E402

OPENAI_SIZE_LIMIT = 25 * 1024 * 1024
DEFAULT_CHUNK_MIN = 10
LOCAL_MODEL = "mlx-community/whisper-large-v3-turbo"
# whisper-1 을 기본으로 두는 이유: verbose_json 으로 **세그먼트 단위 타임스탬프**를 준다.
# gpt-4o-transcribe 는 한국어 정확도가 더 높지만 텍스트만 반환해서, 청크(기본 10분)
# 하나가 통째로 한 블록이 된다 → 회의록의 `[12:34]` 인용이 전부 같은 값으로 뭉개져
# "원문 확인 진입점"이라는 전사문의 존재 이유가 무너진다. 로컬 백엔드도 세그먼트를
# 주므로 기본값을 맞추면 두 백엔드의 산출물 형태가 같아진다.
# 정확도를 우선해야 하면 --model gpt-4o-transcribe.
OPENAI_MODEL = "whisper-1"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def need(binary: str) -> None:
    if not shutil.which(binary):
        raise SystemExit(f"{binary} 없음. `brew install {binary}` 후 다시 실행하라.")


def duration_sec(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def normalize(src: Path, workdir: Path) -> Path:
    """16kHz 모노 mp3로 변환. Whisper 계열은 내부적으로 16k로 리샘플하므로
    원본 비트레이트를 유지할 이유가 없고, 용량이 1/4 이하로 줄어 API 한도를 넘지 않는다.

    출력 파일명은 원본과 무관한 고정 이름을 쓴다 — 원본명에 glob 메타문자(`[`, `]`,
    `*`)가 들어가면 아래 split()의 파일 수집이 조용히 어긋난다(`회의 [최종].m4a` 등
    한국어 파일명에서 흔하다). 작업 디렉토리는 파일당 하나씩 새로 만들므로 충돌 없다."""
    dst = workdir / "audio.norm.mp3"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src),
         "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", str(dst)],
        check=True,
    )
    return dst


def split(src: Path, workdir: Path, chunk_min: int) -> list[Path]:
    if src.stat().st_size <= OPENAI_SIZE_LIMIT:
        return [src]
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src),
         "-f", "segment", "-segment_time", str(chunk_min * 60),
         "-c", "copy", str(workdir / "part%03d.mp3")],
        check=True,
    )
    parts = sorted(workdir.glob("part*.mp3"))
    if not parts:
        raise SystemExit("청크 분할 실패 — 생성된 조각이 없다. --chunk-min 을 줄여 다시 시도하라.")
    return parts


def hhmmss(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# ---------------------------------------------------------------- backends

def probe_local() -> tuple[str | None, str]:
    for mod, label in (("mlx_whisper", "mlx-whisper"), ("faster_whisper", "faster-whisper")):
        try:
            __import__(mod)
            return mod, label
        except ImportError:
            continue
    return None, "없음"


def run_local(audio: Path, language: str, model: str) -> list[dict]:
    mod, label = probe_local()
    if mod is None:
        raise SystemExit(
            "로컬 전사 엔진이 없다. Apple Silicon 권장 설치:\n"
            "  python3 -m pip install mlx-whisper\n"
            "그 외 플랫폼:\n"
            "  python3 -m pip install faster-whisper"
        )
    log(f"  로컬 엔진: {label} / 모델 {model}")
    if mod == "mlx_whisper":
        import mlx_whisper
        res = mlx_whisper.transcribe(str(audio), path_or_hf_repo=model, language=language)
        return [{"start": s["start"], "text": s["text"].strip()} for s in res["segments"]]
    from faster_whisper import WhisperModel
    size = "large-v3" if "large" in model else model
    segs, _ = WhisperModel(size, device="cpu", compute_type="int8").transcribe(
        str(audio), language=language
    )
    return [{"start": s.start, "text": s.text.strip()} for s in segs]


def run_openai(audio: Path, language: str, model: str, key: str, offset: float) -> list[dict]:
    from openai import OpenAI

    client = OpenAI(api_key=key)
    want_segments = model == "whisper-1"
    with audio.open("rb") as fh:
        res = client.audio.transcriptions.create(
            model=model, file=fh, language=language,
            response_format="verbose_json" if want_segments else "text",
        )
    if want_segments:
        return [{"start": offset + s.start, "text": s.text.strip()} for s in res.segments]
    text = res if isinstance(res, str) else getattr(res, "text", str(res))
    return [{"start": offset, "text": text.strip()}]


# ---------------------------------------------------------------- output

def group(segments: list[dict], block_sec: int = 45) -> list[dict]:
    """짧은 세그먼트를 문단으로 묶는다. 세그먼트 단위로 출력하면 수천 줄이 되어
    사람도 에이전트도 읽기 어렵다."""
    blocks: list[dict] = []
    for seg in segments:
        if not seg["text"]:
            continue
        if blocks and seg["start"] - blocks[-1]["start"] < block_sec:
            blocks[-1]["text"] += " " + seg["text"]
        else:
            blocks.append({"start": seg["start"], "text": seg["text"]})
    return blocks


def yaml_scalar(v: str) -> str:
    """frontmatter 값을 안전하게 인용한다. 파일명에 `:` 나 `[`가 들어가면
    (`회의: 8월 안건 [최종].m4a`) 인용 없이는 YAML 파싱이 깨지고, Obsidian이
    frontmatter 전체를 못 읽는다 — backend/sensitivity 같은 감사 흔적이 통째로 사라진다."""
    s = str(v)
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_transcript(src: Path, blocks: list[dict], meta: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{meta['date']}-{src.stem}.transcript.md"
    fm = "\n".join(f"{k}: {yaml_scalar(v)}" for k, v in meta.items())
    body = "\n\n".join(f"**[{hhmmss(b['start'])}]** {b['text']}" for b in blocks)
    out.write_text(
        f"---\ntype: transcript\n{fm}\n---\n\n# 전사 · {src.stem}\n\n{body}\n",
        encoding="utf-8",
    )
    out.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "blocks": blocks}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out


# ---------------------------------------------------------------- main

def check() -> int:
    print("=== 백엔드 가용성 ===")
    for b in ("ffmpeg", "ffprobe"):
        print(f"  {'✓' if shutil.which(b) else '✗'} {b}")
    _, label = probe_local()
    print(f"  {'✓' if label != '없음' else '✗'} local  ({label})")
    key, source = apikey.resolve()
    print(f"  {'✓' if key else '✗'} openai ({source})")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="음성 녹음 전사")
    ap.add_argument("--backend", choices=["local", "openai"])
    ap.add_argument("--input", nargs="+")
    ap.add_argument("--out-dir", default="raw/meetings/transcripts")
    ap.add_argument("--language", default="ko")
    ap.add_argument("--model")
    ap.add_argument("--chunk-min", type=int, default=DEFAULT_CHUNK_MIN)
    ap.add_argument("--api-key")
    ap.add_argument("--confirm-upload", action="store_true",
                    help="openai 백엔드 필수. 오디오 외부 전송에 대한 명시적 동의.")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        return check()
    if not args.backend or not args.input:
        ap.error("--backend 와 --input 은 필수 (또는 --check)")

    need("ffmpeg")
    need("ffprobe")

    key = None
    if args.backend == "openai":
        if not args.confirm_upload:
            raise SystemExit(
                "openai 백엔드는 오디오를 외부 서버로 전송한다.\n"
                "민감 회의(인사·평가·심사·계약·개인정보)라면 --backend local 을 쓰라.\n"
                "일반 업무회의로 판단했다면 --confirm-upload 를 붙여 다시 실행하라."
            )
        key, source = apikey.resolve(args.api_key)
        if not key:
            raise SystemExit("OpenAI 키 없음. `python3 apikey.py set-keychain` 실행하라.")
        log(f"키 출처: {source}")

    model = args.model or (LOCAL_MODEL if args.backend == "local" else OPENAI_MODEL)
    results = []

    for raw in args.input:
        src = Path(raw).expanduser()
        if not src.exists():
            raise SystemExit(f"파일 없음: {src}")
        dur = duration_sec(src)
        log(f"\n▶ {src.name} ({dur/60:.1f}분) · backend={args.backend} · model={model}")

        with tempfile.TemporaryDirectory(prefix="mm-") as tmp:
            work = Path(tmp)
            norm = normalize(src, work)
            log(f"  정규화 {src.stat().st_size/1e6:.1f}MB → {norm.stat().st_size/1e6:.1f}MB")

            segments: list[dict] = []
            if args.backend == "local":
                segments = run_local(norm, args.language, model)
            else:
                parts = split(norm, work, args.chunk_min)
                log(f"  {len(parts)}개 청크 전송")
                for i, part in enumerate(parts):
                    log(f"    [{i+1}/{len(parts)}] {part.name}")
                    segments += run_openai(part, args.language, model, key,
                                           offset=i * args.chunk_min * 60)

        blocks = group(segments)
        meta = {
            "source_audio": src.name,
            "duration_min": f"{dur/60:.1f}",
            "backend": args.backend,
            "model": model,
            "language": args.language,
            "date": date.today().isoformat(),
            "sensitivity": "confidential" if args.backend == "local" else "internal",
        }
        out = write_transcript(src, blocks, meta, Path(args.out_dir))
        chars = sum(len(b["text"]) for b in blocks)
        log(f"  ✓ {out}  ({len(blocks)}블록 · {chars:,}자)")
        results.append({"audio": str(src), "transcript": str(out),
                        "blocks": len(blocks), "chars": chars, **meta})

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
