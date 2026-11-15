#!/usr/bin/env python3
"""
build-branding.py

Makes every installer and brand picture of Apna Billing (client app) and Apna Billing Admin.

    python scripts/build-branding.py

Needs Python 3 with Pillow and numpy. Originals are only read, and all are optional:

    branding/source/app-icon.png         client icon tile on a white (or transparent) background, square
    branding/source/admin-icon.png       admin icon tile, the same way
    branding/source/sidebar-art.png      tall background picture for the client installer (no text on it)
    branding/source/admin-sidebar-art.png  the same for the admin installer

Without them the current app icons (tauri/src-tauri/icons, admin-tauri/src-tauri/icons) and a drawn
background are used. Name, tagline and icon are always drawn on top by this script, so they stay sharp.

Written (see branding/README.md for what each is for):
    branding/app-icon/<app>.png                      1024 x 1024 icon with transparent corners
    branding/installer/<app>/installer-icon.ico      16-256 px
    branding/installer/<app>/sidebar-492x942.bmp     welcome / finish pages, 3x: Installer Studio makes every
                                                     display scaling from it (also 328 x 628 and 164 x 314)
    branding/installer/<app>/header-450x171.bmp      inner pages, 3x (also 300 x 114 and 150 x 57)
    branding/installer/<app>/wizard-small-*.bmp, banner-493x58.bmp, dialog-493x312.bmp
    branding/logo/<app>-logo-dark.png, <app>-logo-light.png, <app>-symbol.png
    branding/marketing/<app>-share-1200x630.png
    branding/preview.png                             everything on one sheet, to check at a glance
"""
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'branding'
SOURCE = BRAND / 'source'
FONTS = Path('C:/Windows/Fonts')
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]   # 20 / 40: 125% / 250% scaling


@dataclass
class App:
    key: str            # file-name prefix
    name: str
    tagline: str
    icon_fallback: Path
    light: tuple        # glow / accent
    accent: tuple       # tagline colour on dark
    deep: tuple         # top of the dark background
    darkest: tuple      # bottom of the dark background
    ink: tuple          # name colour on white


APPS = [
    App('apna-billing', 'Apna Billing', 'Billing  ·  Stock  ·  Accounts',
        ROOT / 'tauri' / 'src-tauri' / 'icons' / 'icon.png',
        light=(52, 211, 153), accent=(167, 243, 208), deep=(6, 78, 59), darkest=(2, 30, 22), ink=(6, 78, 59)),
    App('apna-billing-admin', 'Apna Billing Admin', 'Customers  ·  Licences  ·  Updates',
        ROOT / 'admin-tauri' / 'src-tauri' / 'icons' / 'icon.png',
        light=(129, 140, 248), accent=(199, 210, 254), deep=(30, 27, 75), darkest=(12, 10, 36), ink=(49, 46, 129)),
]


def font(bold: bool, size: int) -> ImageFont.FreeTypeFont:
    for name in (['segoeuib.ttf', 'seguisb.ttf'] if bold else ['seguisb.ttf', 'segoeui.ttf']):
        if (FONTS / name).exists():
            return ImageFont.truetype(str(FONTS / name), size)
    return ImageFont.load_default(size)


# ------------------------------------------------------------------ icon

def cut_out(img: Image.Image) -> Image.Image:
    """Icon tile from a generated picture: crop to the tile and make the white around it transparent."""
    img = img.convert('RGBA')
    rgba = np.asarray(img).astype(np.float32)
    if rgba[..., 3].min() < 250:            # already has transparency
        alpha = rgba[..., 3]
    else:                                   # white background: distance from white becomes opacity
        dist = 255 - rgba[..., :3].min(axis=2)
        alpha = np.clip((dist - 12) * 6, 0, 255)
        alpha = np.asarray(Image.fromarray(alpha.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1)), dtype=np.float32)
    ys, xs = np.nonzero(alpha > 128)
    if len(xs) == 0:
        raise SystemExit('The icon picture looks empty')
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    out = np.dstack([rgba[..., :3], alpha]).astype(np.uint8)
    tile = Image.fromarray(out).crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    return tile


def app_icon(app: App) -> Image.Image:
    src = SOURCE / ('admin-icon.png' if 'admin' in app.key else 'app-icon.png')
    tile = cut_out(Image.open(src)) if src.exists() else Image.open(app.icon_fallback).convert('RGBA')
    return tile.resize((1024, 1024), Image.LANCZOS)


def with_shadow(icon: Image.Image, size: int, blur: int, opacity: int) -> Image.Image:
    """Icon of `size` with a soft drop shadow, on a transparent canvas with room for the shadow."""
    pad = blur * 3
    canvas = Image.new('RGBA', (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
    small = icon.resize((size, size), Image.LANCZOS)
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    mask = small.getchannel('A').point(lambda a: a * opacity // 255)
    shadow.paste((0, 0, 0, 255), (pad, pad + blur // 2), mask)
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(small, (pad, pad))
    return canvas


# ------------------------------------------------------------------ backgrounds

def dark_art(app: App, w: int, h: int) -> Image.Image:
    """Background of the sidebar: the pasted picture (darkened for the text), or a drawn one."""
    src = SOURCE / ('admin-sidebar-art.png' if 'admin' in app.key else 'sidebar-art.png')
    if src.exists():
        art = Image.open(src).convert('RGB')
        scale = max(w / art.width, h / art.height)
        art = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
        left, top = (art.width - w) // 2, (art.height - h) // 2
        art = art.crop((left, top, left + w, top + h))
        shade = np.linspace(0.35, 0.75, h)[:, None, None]       # darker towards the bottom, for the text
        tint = np.array(app.darkest, dtype=np.float32)
        px = np.asarray(art, dtype=np.float32) * (1 - shade) + tint * shade
        return Image.fromarray(px.clip(0, 255).astype(np.uint8)).convert('RGBA')

    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    deep, darkest, light = (np.array(c, dtype=np.float32) for c in (app.deep, app.darkest, app.light))
    base = deep[None, None, :] * (1 - y[..., None]) + darkest[None, None, :] * y[..., None]
    # Soft light from the top left, and a fainter one low on the right
    glow = np.exp(-(((x - 0.15) / 0.55) ** 2 + ((y - 0.05) / 0.35) ** 2)) * 0.55
    glow += np.exp(-(((x - 1.0) / 0.45) ** 2 + ((y - 0.85) / 0.25) ** 2)) * 0.18
    px = base + (light[None, None, :] - base) * glow[..., None] * 0.6
    img = Image.fromarray(px.clip(0, 255).astype(np.uint8)).convert('RGBA')

    # Fine dot grid, fading out downwards
    dots = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(dots)
    step = max(12, w // 14)
    r = max(1, w // 260)
    for gy in range(step // 2, h, step):
        a = int(38 * (1 - gy / h))
        for gx in range(step // 2, w, step):
            d.ellipse((gx - r, gy - r, gx + r, gy + r), fill=(255, 255, 255, a))
    img = Image.alpha_composite(img, dots)

    # Two large faint rings bottom right
    rings = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(rings)
    for i, rad in enumerate((0.55, 0.85)):
        R = int(w * rad)
        cx, cy = int(w * 1.05), int(h * 0.98)
        d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=(*app.accent, 34 - i * 12), width=max(2, w // 120))
    return Image.alpha_composite(img, rings)


def text_center(d: ImageDraw.ImageDraw, w: int, y: int, text: str, f, fill, max_w: int):
    while d.textlength(text, font=f) > max_w and f.size > 8:
        f = ImageFont.truetype(f.path, f.size - 2)
    d.text(((w - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)
    return f


# ------------------------------------------------------------------ pictures

def sidebar(app: App, icon: Image.Image, w: int = 328, h: int = 628) -> Image.Image:
    S = 3                                       # drawn at 3x, then reduced: crisp edges and text
    W, H = w * S, h * S
    img = dark_art(app, W, H)
    ic = with_shadow(icon, int(W * 0.46), blur=W // 40, opacity=150)
    img.alpha_composite(ic, ((W - ic.width) // 2, int(H * 0.17) - (ic.height - int(W * 0.46)) // 2))
    d = ImageDraw.Draw(img)
    name_top = int(H * 0.17) + int(W * 0.46) + int(H * 0.055)
    words = app.name.split(' ')
    lines = [' '.join(words[:2]), ' '.join(words[2:])] if len(words) > 2 else [app.name]
    f = font(True, int(W * 0.128))
    for i, line in enumerate(lines):
        f = text_center(d, W, name_top + i * int(f.size * 1.18), line, f, (255, 255, 255), int(W * 0.86))
    tag_y = name_top + len(lines) * int(f.size * 1.18) + int(H * 0.018)
    d.rounded_rectangle(((W - W * 0.16) / 2, tag_y, (W + W * 0.16) / 2, tag_y + S * 3), radius=S * 2, fill=(*app.light, 255))
    text_center(d, W, tag_y + int(H * 0.03), app.tagline, font(False, int(W * 0.052)), (*app.accent, 255), int(W * 0.9))
    return img.resize((w, h), Image.LANCZOS).convert('RGB')


def header(app: App, icon: Image.Image, w: int = 300, h: int = 114) -> Image.Image:
    """Top right of the inner pages, on the white header of the wizard: icon and name."""
    S = 3
    W, H = w * S, h * S
    img = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    size = int(H * 0.72)
    img.alpha_composite(icon.resize((size, size), Image.LANCZOS), (W - size - int(H * 0.12), (H - size) // 2))
    d = ImageDraw.Draw(img)
    words = app.name.split(' ')
    lines = [' '.join(words[:2]), ' '.join(words[2:])] if len(words) > 2 else [app.name]
    f = font(True, int(H * 0.25))
    right = W - size - int(H * 0.28)
    total = len(lines) * f.size * 1.15
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=f)
        d.text((right - tw, (H - total) / 2 + i * f.size * 1.15 - f.size * 0.12), line, font=f,
               fill=(*app.ink, 255) if i == 0 else (*app.light, 255))
    return img.resize((w, h), Image.LANCZOS).convert('RGB')


def on_white(icon: Image.Image, w: int, h: int, scale: float = 0.86) -> Image.Image:
    img = Image.new('RGBA', (w, h), (255, 255, 255, 255))
    size = int(min(w, h) * scale)
    img.alpha_composite(icon.resize((size, size), Image.LANCZOS), ((w - size) // 2, (h - size) // 2))
    return img.convert('RGB')


def msi_dialog(app: App, icon: Image.Image) -> Image.Image:
    img = Image.new('RGB', (493, 312), (255, 255, 255))
    img.paste(sidebar(app, icon, 164, 312), (0, 0))
    return img


def banner(app: App, icon: Image.Image) -> Image.Image:
    img = Image.new('RGBA', (493, 58), (255, 255, 255, 255))
    img.alpha_composite(icon.resize((46, 46), Image.LANCZOS), (493 - 46 - 8, 6))
    return img.convert('RGB')


def logo(app: App, icon: Image.Image, dark: bool) -> Image.Image:
    W, H = 2400, 800
    img = Image.new('RGBA', (W, H), (*app.darkest, 255) if dark else (255, 255, 255, 255))
    if dark:
        img = dark_art(app, W, H)
    size, gap = 400, 80
    d = ImageDraw.Draw(img)
    f, t = font(True, 180), font(False, 68)
    text_w = lambda: max(d.textlength(app.name, font=f), d.textlength(app.tagline, font=t))
    while size + gap + text_w() > W * 0.84:          # long names: smaller text, never off the edge
        f, t = font(True, f.size - 6), font(False, max(40, t.size - 2))
    x0 = (W - (size + gap + text_w())) / 2
    pad = 18 * 3
    img.alpha_composite(with_shadow(icon, size, 18, 120 if dark else 60), (int(x0) - pad, (H - size) // 2 - pad))
    name_box = d.textbbox((0, 0), app.name, font=f)
    tag_box = d.textbbox((0, 0), app.tagline, font=t)
    space = f.size * 0.28                              # clear of the name's descenders (g, p)
    block = (name_box[3] - name_box[1]) + space + (tag_box[3] - tag_box[1])
    top = (H - block) / 2
    d.text((x0 + size + gap, top - name_box[1]), app.name, font=f, fill=(255, 255, 255) if dark else app.ink)
    d.text((x0 + size + gap + 4, top + (name_box[3] - name_box[1]) + space - tag_box[1]), app.tagline, font=t,
           fill=app.accent if dark else app.light)
    return img


def share(app: App, icon: Image.Image) -> Image.Image:
    W, H = 1200, 630
    img = dark_art(app, W, H)
    d = ImageDraw.Draw(img)
    size = 300
    img.alpha_composite(with_shadow(icon, size, 16, 140), (110 - 48, (H - size) // 2 - 48))
    f = font(True, 92)
    d.text((470, H / 2 - 120), app.name.replace(' Admin', ''), font=f, fill=(255, 255, 255))
    if 'Admin' in app.name:
        d.text((470, H / 2 - 10), 'Admin', font=font(True, 70), fill=app.accent)
    d.text((474, H / 2 + (80 if 'Admin' in app.name else 0)), app.tagline, font=font(False, 40), fill=app.accent)
    return img.convert('RGB')


def save_ico(icon: Image.Image, out: Path):
    icon.save(out, format='ICO', sizes=[(s, s) for s in ICO_SIZES])


def main():
    sheet_items = []
    for app in APPS:
        icon = app_icon(app)
        inst = BRAND / 'installer' / app.key
        for d in (BRAND / 'app-icon', inst, BRAND / 'logo', BRAND / 'marketing'):
            d.mkdir(parents=True, exist_ok=True)

        icon.save(BRAND / 'app-icon' / f'{app.key}.png')
        save_ico(icon, inst / 'installer-icon.ico')
        sidebar(app, icon, 492, 942).save(inst / 'sidebar-492x942.bmp')
        side2x = sidebar(app, icon)
        side2x.save(inst / 'sidebar-328x628.bmp')
        sidebar(app, icon, 164, 314).save(inst / 'sidebar-164x314.bmp')
        header(app, icon, 450, 171).save(inst / 'header-450x171.bmp')
        head2x = header(app, icon)
        head2x.save(inst / 'header-300x114.bmp')
        header(app, icon, 150, 57).save(inst / 'header-150x57.bmp')
        on_white(icon, 55, 58).save(inst / 'wizard-small-55x58.bmp')
        on_white(icon, 110, 116).save(inst / 'wizard-small-110x116.bmp')
        banner(app, icon).save(inst / 'banner-493x58.bmp')
        msi_dialog(app, icon).save(inst / 'dialog-493x312.bmp')

        icon.resize((512, 512), Image.LANCZOS).save(BRAND / 'logo' / f'{app.key}-symbol.png')
        logo(app, icon, True).convert('RGB').save(BRAND / 'logo' / f'{app.key}-logo-dark.png')
        logo(app, icon, False).convert('RGB').save(BRAND / 'logo' / f'{app.key}-logo-light.png')
        sh = share(app, icon)
        sh.save(BRAND / 'marketing' / f'{app.key}-share-1200x630.png')
        sheet_items.append((app, side2x, head2x, sh))
        print(f'{app.name}: {inst.relative_to(ROOT)}')

    # One sheet with everything that matters, to check the result at a glance
    sheet = Image.new('RGB', (1720, 1200), (236, 238, 242))
    d = ImageDraw.Draw(sheet)
    for i, (app, side, head, sh) in enumerate(sheet_items):
        x = 40 + i * 860
        d.text((x, 20), app.name, font=font(True, 30), fill=(30, 30, 40))
        sheet.paste(side, (x, 70))
        sheet.paste(head, (x + 360, 70))
        sheet.paste(Image.open(BRAND / 'installer' / app.key / 'sidebar-164x314.bmp'), (x + 360, 210))
        sheet.paste(Image.open(BRAND / 'installer' / app.key / 'header-150x57.bmp'), (x + 540, 210))
        sheet.paste(sh.resize((780, 410), Image.LANCZOS), (x, 720))
        d.text((x, 1150), 'sidebar 328x628 | header 300x114 | 1x sizes | share 1200x630', font=font(False, 18), fill=(90, 90, 100))
    sheet.save(BRAND / 'preview.png')
    print(f'Preview: {(BRAND / "preview.png").relative_to(ROOT)}')


if __name__ == '__main__':
    main()
