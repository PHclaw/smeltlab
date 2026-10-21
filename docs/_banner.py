"""生成 GitHub 社交预览横幅（1280×640）与公众号头图（900×383）。"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
FONT = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

BG_TOP = (17, 24, 39)
BG_BOTTOM = (8, 11, 20)
INDIGO = (129, 140, 248)
GRAY = (156, 163, 175)
WHITE = (255, 255, 255)


def gradient(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height))
    for y in range(height):
        ratio = y / max(height - 1, 1)
        color = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * ratio) for i in range(3))
        for x in range(width):
            image.putpixel((x, y), color)
    return image


def rounded(source: Image.Image, size: tuple[int, int], radius: int = 18) -> Image.Image:
    card = source.resize(size, Image.LANCZOS)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    output.paste(card, (0, 0), mask)
    return output


def with_shadow(card: Image.Image, canvas: Image.Image, position: tuple[int, int]) -> None:
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer = Image.new("RGBA", card.size, (0, 0, 0, 120))
    shadow.paste(layer, position, card.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(card, position)


def text(draw: ImageDraw.ImageDraw, xy, content, size, color, bold=False):
    font = ImageFont.truetype(FONT_BOLD if bold else FONT, size)
    draw.text(xy, content, font=font, fill=color)
    return draw.textlength(content, font=font)


def build(width: int, height: int, out: Path, compact: bool = False, footer: str | None = None) -> None:
    canvas = gradient(width, height).convert("RGBA")

    # 左侧文案区
    draw = ImageDraw.Draw(canvas)
    left = int(width * 0.07)
    title_size = 84 if not compact else 56
    text(draw, (left, int(height * 0.17)), "SmeltLab", title_size, WHITE, bold=True)

    tagline = "AI 数据清洗 · 一键建模 · 全程可视化"
    text(draw, (left, int(height * 0.17) + title_size + 26), tagline, 34 if not compact else 24, INDIGO)

    bullets = [
        "上传脏数据 → 一句话 → 拿到干净数据与模型",
        "健康分体检 / 9 种清洗 / 泄漏列自动识别",
        "随机森林 · 梯度提升 · 逻辑回归 · 神经网络",
        "数据不出本地 · MIT 开源",
    ]
    body_size = 28 if not compact else 20
    top = int(height * 0.17) + title_size + 26 + (48 if not compact else 34)
    for index, line in enumerate(bullets):
        y = top + index * (body_size + 22)
        draw.ellipse([left, y + body_size * 0.42, left + 9, y + body_size * 0.42 + 9], fill=INDIGO)
        text(draw, (left + 24, y), line, body_size, GRAY)

    repo = footer if footer is not None else "github.com/<your-org>/SmeltLab"
    text(draw, (left, height - int(height * 0.13)), repo, 26 if not compact else 18, (107, 114, 128))

    # 右侧截图卡片
    right_x = int(width * 0.55)
    card_w = int(width * 0.40)
    card_h = int(card_w * 0.56)
    if compact:
        card_w = int(width * 0.42)
        card_h = int(card_w * 0.52)

    top_card = rounded(Image.open(SHOTS / "chat-cleaning.png").convert("RGB"), (card_w, card_h))
    bottom_card = rounded(Image.open(SHOTS / "train-result.png").convert("RGB"), (card_w, card_h))
    gap = int(height * 0.05)
    first_y = int((height - (card_h * 2 + gap)) / 2)
    with_shadow(top_card, canvas, (right_x, first_y))
    with_shadow(bottom_card, canvas, (right_x, first_y + card_h + gap))

    canvas.convert("RGB").save(out, quality=95)
    print("banner ->", out.name, f"{width}x{height}")


# 社交预览版：底部放仓库地址（分享卡片用）
build(1280, 640, ROOT / "banner-1280x640.png")
# README 头图版：不出现占位地址，仓库未定时首屏不露怯
build(1280, 640, ROOT / "banner-readme.png", footer="MIT 开源 · 数据不出本地 · 过程全程可见")
# 文章头图
build(900, 383, ROOT / "banner-900x383.png", compact=True)
