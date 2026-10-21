"""重新合成视频片尾：去掉旧片尾（3s）→ 拼接新片尾卡 → 重生成竖屏版。"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENDCARD_SECONDS = 3.0

VIDEOS = [
    "demo1-ai-clean.mp4",
    "demo2-one-click-train.mp4",
    "demo3-one-sentence.mp4",
    "demo4-chat-training.mp4",
]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


for name in VIDEOS:
    source = ROOT / name
    total = duration(source)
    body = total - ENDCARD_SECONDS

    trimmed = ROOT / f"_trim_{name}"
    run([
        "ffmpeg", "-v", "error", "-y", "-t", f"{body:.3f}", "-i", str(source),
        "-c", "copy", str(trimmed),
    ])
    run([
        "ffmpeg", "-v", "error", "-y",
        "-i", str(trimmed), "-i", str(ROOT / "endcard_h.mp4"),
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(ROOT / f"_new_{name}"),
    ])
    trimmed.unlink()
    (ROOT / f"_new_{name}").replace(source)
    print(f"横屏已更新: {name} ({duration(source):.1f}s)")

    vertical = ROOT / name.replace(".mp4", "-vertical.mp4")
    run([
        "ffmpeg", "-v", "error", "-y", "-i", str(source),
        "-filter_complex",
        "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,boxblur=24:4,crop=1920:1080[bg];"
        "[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(vertical),
    ])
    print(f"竖屏已更新: {vertical.name}")

print("全部完成")
