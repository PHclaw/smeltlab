"""视频后期：加速 → 追加片尾引导卡 → 输出横屏成品；再生成 9:16 竖屏版。"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# (源 webm, 加速倍数, 成品文件名)
JOBS = [
    ("v1-clean.webm", 1.5, "demo1-ai-clean.mp4"),
    ("v2-train.webm", 1.0, "demo2-one-click-train.mp4"),
    ("v3-oneshot.webm", 2.5, "demo3-one-sentence.mp4"),
    ("v4-chat-train.webm", 3.5, "demo4-chat-training.mp4"),
]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


for source, speed, final in JOBS:
    tmp = ROOT / f"_tmp_{final}"
    run([
        "ffmpeg", "-v", "error", "-y", "-i", str(ROOT / source),
        "-filter:v", f"setpts=PTS/{speed},fps=30",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-pix_fmt", "yuv420p", str(tmp),
    ])
    run([
        "ffmpeg", "-v", "error", "-y",
        "-i", str(tmp), "-i", str(ROOT / "endcard_h.mp4"),
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(ROOT / final),
    ])
    tmp.unlink()
    print(f"横屏成品: {final}")

    vertical = ROOT / final.replace(".mp4", "-vertical.mp4")
    run([
        "ffmpeg", "-v", "error", "-y", "-i", str(ROOT / final),
        "-filter_complex",
        "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,boxblur=24:4,crop=1920:1080[bg];"
        "[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(vertical),
    ])
    print(f"竖屏成品: {vertical.name}")

print("全部完成")
