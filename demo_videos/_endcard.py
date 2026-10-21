"""生成片尾引导卡（横屏 + 竖屏），供视频合成使用。"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FONT = "C\\:/Windows/Fonts/msyh.ttc"

# (文本, 字号, 颜色, 相对画面中心的垂直偏移)
H_LINES = [
    ("SmeltLab", 78, "white", -90),
    ("AI 数据清洗 · 一键建模 · 训练全程可视化", 32, "0x9CA3AF", 10),
    ("GitHub 搜索 SmeltLab · 开源可本地运行", 42, "0x818CF8", 80),
    ("欢迎 Star 支持一下", 30, "0x6B7280", 150),
]
V_LINES = [
    ("SmeltLab", 96, "white", -120),
    ("AI 数据清洗 · 一键建模 · 训练全程可视化", 38, "0x9CA3AF", 0),
    ("GitHub 搜索 SmeltLab · 开源可本地运行", 46, "0x818CF8", 90),
    ("欢迎 Star 支持一下", 34, "0x6B7280", 175),
]


def build(width: int, height: int, lines, out: Path) -> None:
    filters = ["fade=t=in:st=0:d=0.4,fade=t=out:st=2.5:d=0.5"]
    for text, size, color, offset in lines:
        filters.append(
            "drawtext=fontfile='{font}':text='{text}':fontcolor={color}:fontsize={size}"
            ":x=(w-text_w)/2:y=(h-text_h)/2{offset:+d}".format(
                font=FONT, text=text, color=color, size=size, offset=offset
            )
        )
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0B0F19:s={width}x{height}:d=3:r=30",
        "-vf", ",".join(filters),
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(out),
    ]
    subprocess.run(cmd, check=True)
    print("endcard ->", out.name)


build(1280, 720, H_LINES, ROOT / "endcard_h.mp4")
build(1080, 1920, V_LINES, ROOT / "endcard_v.mp4")
