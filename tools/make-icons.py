#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-icons.py — 生成 PWA 图标（开发期一次性脚本，不参与应用的运行）

LifeLite 本身零依赖、零构建；这个脚本只是为了让仓库里的 PNG 可以被复现。
需要 Pillow：

    python tools/make-icons.py

输出：
    icons/icon-192.png          普通图标 192×192（圆角、透明外角）
    icons/icon-512.png          普通图标 512×512
    icons/icon-512-maskable.png 遮罩图标 512×512（满版背景，内容留出安全区）

图形语言与界面一致：品牌蓝渐变底 + 白色「目标环 + 对勾」，寓意「把目标拆成
能完成的小步，然后一个个打勾」。
"""

import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(os.path.dirname(HERE), "icons")

# 与 css/style.css 的设计令牌保持一致
BLUE_LIGHT = (74, 134, 247)   # #4a86f7
BLUE_DARK = (36, 89, 196)     # #2459c4
WHITE = (255, 255, 255, 255)

SS = 4  # 超采样倍数：先画大图再缩小，边缘更平滑


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def gradient(size):
    """从上到下的线性渐变"""
    base = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / float(size - 1)
        base.putpixel(
            (0, y),
            (
                int(BLUE_LIGHT[0] + (BLUE_DARK[0] - BLUE_LIGHT[0]) * t),
                int(BLUE_LIGHT[1] + (BLUE_DARK[1] - BLUE_LIGHT[1]) * t),
                int(BLUE_LIGHT[2] + (BLUE_DARK[2] - BLUE_LIGHT[2]) * t),
            ),
        )
    return base.resize((size, size))


def draw_glyph(size, scale=1.0):
    """白色目标环 + 对勾，返回 RGBA 图层。scale 用于遮罩图标留安全区。"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx = cy = size / 2.0
    ring_r = size * 0.30 * scale
    ring_w = max(1, int(size * 0.052 * scale))

    # 目标环：外圈实线，内圈用更细的一圈暗示「目标层级」
    draw.ellipse(
        [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
        outline=WHITE,
        width=ring_w,
    )
    inner_r = ring_r * 0.55
    draw.ellipse(
        [cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r],
        outline=(255, 255, 255, 150),
        width=max(1, int(ring_w * 0.42)),
    )

    # 对勾：压在环的右下方，形成「目标已达成」的徽标感
    stroke = max(1, int(size * 0.062 * scale))
    check = [
        (cx - ring_r * 0.52, cy + ring_r * 0.06),
        (cx - ring_r * 0.12, cy + ring_r * 0.46),
        (cx + ring_r * 0.62, cy - ring_r * 0.38),
    ]
    draw.line(check, fill=WHITE, width=stroke, joint="curve")
    # 圆头端点
    for point in (check[0], check[-1]):
        r = stroke / 2.0
        draw.ellipse([point[0] - r, point[1] - r, point[0] + r, point[1] + r], fill=WHITE)
    return layer


def make_icon(px, maskable=False):
    size = px * SS
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(gradient(size), (0, 0))

    if not maskable:
        # 普通图标：22% 圆角，外角透明
        canvas.putalpha(rounded_mask(size, int(size * 0.226)))
    else:
        # 遮罩图标：满版，内容缩到 78%，保证被裁成圆形/圆角后仍完整
        canvas = canvas.convert("RGBA")

    glyph = draw_glyph(size, scale=0.78 if maskable else 1.0)
    canvas.alpha_composite(glyph)

    # 轻微内高光，让纯色块不那么死板
    if not maskable:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow)
        gdraw.ellipse(
            [size * 0.12, size * 0.02, size * 0.88, size * 0.62],
            fill=(255, 255, 255, 26),
        )
        glow = glow.filter(ImageFilter.GaussianBlur(size * 0.06))
        canvas.alpha_composite(glow)

    return canvas.resize((px, px), Image.LANCZOS)


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-512-maskable.png", 512, True),
    ]
    for name, px, maskable in jobs:
        path = os.path.join(ICON_DIR, name)
        make_icon(px, maskable).save(path, "PNG", optimize=True)
        print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
