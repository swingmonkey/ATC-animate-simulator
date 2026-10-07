"""生成应用图标 build/icon.ico（雷达/塔台主题，使用项目配色）。

用法：
    python tools/make-icon.py

依赖：Pillow（pip install Pillow）
输出：
    build/icon.ico          多尺寸图标（16~256），electron-builder 写入 exe + 窗口图标
    %TEMP%/atc-icon-preview.png  256px 预览图（便于人工核验，不进入仓库）

设计要点：深色雷达屏 + 三级管制区圆环 + 绿色扫描扇区 + 雷达航迹（leader line）目标点，
元素尽量少、笔画尽量粗，保证缩小到 16px 仍可辨识。配色与 js/data/atcUnits.js 一致：
    区调 #7c3aed / 进近 #0369a1 / 塔台 #b45309 / 扫描 #22c55e
"""

import os
import tempfile

from PIL import Image, ImageChops, ImageDraw

# 主图尺寸（先大尺寸绘制再 LANCZOS 缩小，获得抗锯齿）
S = 1024
CX = CY = S // 2

BG_TOP = (30, 41, 59, 255)      # #1e293b
BG_BOTTOM = (15, 23, 42, 255)   # #0f172a
RING = (148, 163, 184, 150)     # #94a3b8
RING_MAJOR = (148, 163, 184, 210)
SWEEP = (34, 197, 94, 235)      # #22c55e
TOWER = (180, 83, 9, 255)       # #b45309
APP = (3, 105, 161, 255)        # #0369a1
ACC = (124, 58, 237, 255)       # #7c3aed
BLIP = (248, 250, 252, 255)     # #f8fafc


def vertical_gradient(size, top, bottom):
    grad = Image.new("RGBA", (1, size), bottom)
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), (
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
            255,
        ))
    return grad.resize((size, size))


def rounded_background():
    """圆角方形底：Windows 图标常用方形底，圆角 22%。"""
    bg = vertical_gradient(S, BG_TOP, BG_BOTTOM)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    return out


def draw_scope(base):
    """三级管制区圆环 + 十字线：进近 60km 环最亮，塔台 15km 环用琥珀色。"""
    d = ImageDraw.Draw(base)
    lw = int(S * 0.011)

    for r_ratio, color in ((0.455, RING), (0.315, RING), (0.175, RING_MAJOR)):
        r = S * r_ratio
        d.ellipse([CX - r, CY - r, CX + r, CY + r], outline=color, width=lw)

    # 十字准线（更暗，仅作背景纹理）
    cross = (148, 163, 184, 70)
    d.line([CX, int(CY - S * 0.475), CX, int(CY + S * 0.475)], fill=cross, width=int(lw * 0.8))
    d.line([int(CX - S * 0.475), CY, int(CX + S * 0.475), CY], fill=cross, width=int(lw * 0.8))


def draw_sweep(base, start_deg=-46, end_deg=-4):
    """扫描扇区：中心亮、边缘淡（用径向 alpha 渐变遮罩实现）。"""
    r = S * 0.47
    grad = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(grad)
    steps = 72
    for i in range(steps, 0, -1):          # 由大到小绘制，内圈高 alpha 覆盖外圈
        rr = r * i / steps
        alpha = int(225 * (1 - (i / steps) ** 0.9))
        gd.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], fill=alpha)

    wedge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(wedge).pieslice(
        [CX - r, CY - r, CX + r, CY + r], start=start_deg, end=end_deg, fill=SWEEP
    )
    wedge.putalpha(ImageChops.multiply(wedge.getchannel("A"), grad))
    base.alpha_composite(wedge)

    # 扫描前沿亮线
    import math
    rad = math.radians(start_deg)
    front = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(front).line(
        [CX, CY, CX + r * math.cos(rad), CY + r * math.sin(rad)],
        fill=(190, 255, 214, 230), width=int(S * 0.012),
    )
    base.alpha_composite(front)


def draw_airport_and_blips(base):
    """中心机场点（塔台）+ 三条雷达航迹（leader line + 目标点）。"""
    d = ImageDraw.Draw(base)

    # 塔台/跑道：中心机场
    r_apt = S * 0.038
    d.ellipse([CX - r_apt, CY - r_apt, CX + r_apt, CY + r_apt], fill=TOWER,
              outline=(255, 255, 255, 235), width=int(S * 0.009))

    # 雷达航迹：从目标点向外引一条短线（真实雷达屏的数据块引线）
    blips = [
        (0.30, -150, 0.085, BLIP),   # (半径比, 角度°, 引线长度比, 颜色)
        (0.36, -58, 0.075, BLIP),
        (0.26, 28, 0.070, BLIP),
        (0.40, 118, 0.065, ACC),
    ]
    import math
    for r_ratio, deg, line_ratio, color in blips:
        rad = math.radians(deg)
        bx, by = CX + S * r_ratio * math.cos(rad), CY + S * r_ratio * math.sin(rad)
        ex, ey = bx + S * line_ratio * math.cos(rad), by + S * line_ratio * math.sin(rad)
        d.line([bx, by, ex, ey], fill=color, width=int(S * 0.009))
        r_dot = S * 0.017
        d.ellipse([bx - r_dot, by - r_dot, bx + r_dot, by + r_dot], fill=color)

    # 进近区提示：一圈高亮弧（进近席位颜色）
    arc_r = S * 0.455
    d.arc([CX - arc_r, CY - arc_r, CX + arc_r, CY + arc_r], start=-96, end=6,
          fill=APP, width=int(S * 0.016))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "build")
    os.makedirs(out_dir, exist_ok=True)

    img = rounded_background()
    draw_scope(img)
    draw_sweep(img)
    draw_airport_and_blips(img)

    icon256 = img.resize((256, 256), Image.LANCZOS)
    ico_path = os.path.join(out_dir, "icon.ico")
    icon256.save(ico_path, format="ICO",
                 sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])

    preview = os.path.join(tempfile.gettempdir(), "atc-icon-preview.png")
    icon256.save(preview)
    print("已生成:", ico_path)
    print("预览图:", preview)


if __name__ == "__main__":
    main()
