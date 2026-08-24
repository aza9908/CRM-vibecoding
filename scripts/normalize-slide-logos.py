#!/usr/bin/env python3
"""Put the «ai research labs» mark in the same place on every Day-1 slide.

The mark is baked into the slide PNGs and it drifted while the deck was built:
most slides carry it bottom-left, a few bottom-right or top-right, and several
either lost it or render it at a contrast that leaves it invisible on a light
background. This script settles on one position — bottom-left, the majority —
and makes every slide match.

    python3 scripts/normalize-slide-logos.py --extract          # refresh assets
    python3 scripts/normalize-slide-logos.py                    # report only
    python3 scripts/normalize-slide-logos.py --apply            # rewrite PNGs

The mark itself lives in `apps/web/public/brand/` as two same-geometry PNGs
lifted off the deck, so the real letterforms survive rather than being
approximated by a redraw.

Finding an existing copy uses masked normalised cross-correlation against that
extracted mark, scored on both polarities. A size-and-density heuristic is not
enough here: eyebrow labels and icon chips sit in the same corners at similar
dimensions, and mistaking one for the logo would erase real slide content.

Removing a stray copy inpaints its box by interpolating across it. Every slide
background is a smooth gradient and the mark always sits on otherwise empty
canvas, so that reconstructs the surface without a visible patch.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover - tooling hint
    sys.exit('Pillow and numpy are required: pip install Pillow numpy')

REPO = Path(__file__).resolve().parents[1]
SLIDES_DIR = REPO / 'apps/web/public/workbook'
BRAND_DIR = REPO / 'apps/web/public/brand'
MARK_DARK = BRAND_DIR / 'ai-research-labs-mark-dark.png'
MARK_LIGHT = BRAND_DIR / 'ai-research-labs-mark-light.png'

# Canonical placement, as a fraction of slide size so it survives a re-export
# at another resolution. These land on (72, 667) of a 1280x719 slide, which is
# exactly where the correct slides already carry the mark — so this script
# leaves them byte-identical instead of nudging the whole deck by a pixel.
ANCHOR_X = 0.05625
ANCHOR_BOTTOM = 0.022253

# Fallback slots, in preference order, for slides whose bottom-left corner is
# taken by a screenshot or a full-width card. Expressed as (x, y) fractions of
# the mark's top-left corner. This is the same escape hatch the deck author
# reached for by hand, just applied consistently.
FALLBACK_ANCHORS = [
    ('top-right', 0.8469, 0.0807),
    ('bottom-right', 0.8469, None),   # None = mirror ANCHOR_BOTTOM
    ('top-left', 0.05625, 0.0807),
]

# A candidate slot counts as free when the canvas behind it is this uniform.
# Empty slide canvas is a smooth gradient (spread well under 10); any card
# edge, screenshot or text pushes it far above.
FREE_SLOT_SPREAD = 14.0
# Breathing room around the mark that must also be clear.
SLOT_MARGIN = 8

# Corners swept for an existing copy, as fractions of slide size. Generous
# enough to catch a mark that is a little off from any of the four corners.
CORNERS = {
    'bottom-left': (0.00, 0.86, 0.26, 1.00),
    'bottom-right': (0.72, 0.86, 1.00, 1.00),
    'top-right': (0.72, 0.00, 1.00, 0.22),
    'top-left': (0.00, 0.00, 0.26, 0.16),
}

# Correlation a window must reach to be called the logo. The mark is a
# distinctive lockup, so genuine hits score far above this and slide copy far
# below; measured separation on this deck is ~0.93 vs ~0.55.
MATCH_THRESHOLD = 0.80

# Minimum luminance gap between the mark's strokes and the canvas behind them.
# Healthy slides in this deck measure 108–189; the three that render the mark in
# a near-white tint on a light background measure 11–18, which is the "present
# but invisible" case this threshold catches.
MIN_CONTRAST = 60.0


def corner_box(size: tuple[int, int], frac) -> tuple[int, int, int, int]:
    w, h = size
    return (
        int(w * frac[0]), int(h * frac[1]),
        int(w * frac[2]), int(h * frac[3]),
    )


def load_template() -> np.ndarray:
    """The mark's alpha, normalised to zero mean — the correlation kernel."""
    alpha = np.asarray(Image.open(MARK_DARK).convert('RGBA'))[:, :, 3]
    t = alpha.astype(np.float64) / 255.0
    return t - t.mean()


def match(gray: np.ndarray, template: np.ndarray) -> tuple[float, tuple[int, int]]:
    """Best masked NCC score of `template` anywhere in `gray`, and where.

    Absolute value, so a light mark on a dark canvas scores the same as a dark
    mark on a light one.
    """
    th, tw = template.shape
    gh, gw = gray.shape
    if gh < th or gw < tw:
        return 0.0, (0, 0)

    windows = np.lib.stride_tricks.sliding_window_view(gray, (th, tw))
    # Zero-mean each window so the score reflects pattern, not brightness.
    means = windows.mean(axis=(2, 3), keepdims=True)
    centred = windows - means
    num = np.abs(np.einsum('ijkl,kl->ij', centred, template))
    denom = np.sqrt(np.einsum('ijkl,ijkl->ij', centred, centred)) * np.sqrt(
        (template * template).sum()
    )
    with np.errstate(divide='ignore', invalid='ignore'):
        scores = np.where(denom > 1e-9, num / denom, 0.0)

    flat = int(scores.argmax())
    y, x = divmod(flat, scores.shape[1])
    return float(scores[y, x]), (x, y)


def find_mark(img: Image.Image, box, template: np.ndarray):
    """Locate the mark inside `box`, returning its absolute box and score."""
    crop = np.asarray(img.convert('L').crop(box)).astype(np.float64)
    score, (x, y) = match(crop, template)
    if score < MATCH_THRESHOLD:
        return None, score
    th, tw = template.shape
    return (box[0] + x, box[1] + y, box[0] + x + tw, box[1] + y + th), score


def erase(img: Image.Image, box) -> None:
    """Rebuild `box` by interpolating across it, row by row."""
    x0, y0, x1, y1 = box
    pad = 3
    px = img.load()
    left_x = max(0, x0 - pad)
    right_x = min(img.width - 1, x1 + pad - 1)
    span = right_x - left_x
    if span <= 0:
        return
    for y in range(y0, y1):
        left = px[left_x, y]
        right = px[right_x, y]
        for x in range(x0, x1):
            f = (x - left_x) / span
            px[x, y] = tuple(
                round(left[i] + (right[i] - left[i]) * f) for i in range(len(left))
            )


def is_light(img: Image.Image, box) -> bool:
    """Perceived lightness of the canvas the mark will land on."""
    patch = np.asarray(img.convert('RGB').crop(box)).astype(np.float64)
    lum = (
        0.2126 * patch[:, :, 0] + 0.7152 * patch[:, :, 1] + 0.0722 * patch[:, :, 2]
    ).mean()
    return lum > 128


def slot_spread(img: Image.Image, box) -> float:
    """How much the canvas varies inside `box` (plus a margin).

    Empty slide canvas is a smooth gradient, so its per-channel spread stays
    small; a card edge, screenshot or line of text raises it sharply. This is
    what keeps the mark from being stamped on top of slide content.
    """
    x0 = max(0, box[0] - SLOT_MARGIN)
    y0 = max(0, box[1] - SLOT_MARGIN)
    x1 = min(img.width, box[2] + SLOT_MARGIN)
    y1 = min(img.height, box[3] + SLOT_MARGIN)
    patch = np.asarray(img.convert('RGB').crop((x0, y0, x1, y1))).astype(np.float64)
    # Row/column gradients are expected; what matters is deviation from the
    # local plane, so compare against a heavily blurred version of itself.
    smooth = np.asarray(
        img.convert('RGB').crop((x0, y0, x1, y1))
        .resize((8, 8), Image.BILINEAR)
        .resize((x1 - x0, y1 - y0), Image.BILINEAR)
    ).astype(np.float64)
    return float(np.abs(patch - smooth).max())


def contrast_at(img: Image.Image, box, alpha: np.ndarray) -> float:
    """Luminance gap between the mark's strokes and the canvas around them.

    Sampled through the template's own alpha, so it measures the copy actually
    printed on the slide rather than the average of the whole box.
    """
    patch = np.asarray(img.convert('L').crop(box)).astype(np.float64)
    strokes = alpha > 140
    canvas = alpha < 20
    if not strokes.any() or not canvas.any():
        return 0.0
    return abs(patch[strokes].mean() - patch[canvas].mean())


def extract_marks() -> None:
    """Lift the mark off the deck into two same-geometry brand assets.

    Slide 24's stray top-right copy is the one place in the deck where the
    lockup sits on empty canvas with nothing overlapping it, which makes it the
    source of truth for the shape. Both variants share a single alpha mask, and
    that is what keeps the light and dark versions pixel-aligned.
    """
    source = SLIDES_DIR / 'slide-24.png'
    img = Image.open(source).convert('RGB')
    x0, y0, x1, y1 = corner_box(img.size, CORNERS['top-right'])
    crop = img.crop((x0, y0, x1, y1))
    arr = np.asarray(crop).astype(np.int16)
    canvas = arr[0, 0]
    dist = np.abs(arr - canvas).sum(axis=2)
    ys, xs = np.nonzero(dist > 26)
    if len(xs) == 0:
        sys.exit(f'no mark found on {source.name}')
    box = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)

    mark = np.asarray(img.crop(box)).astype(np.int16)
    canvas = mark[0, 0]
    d = np.abs(mark - canvas).sum(axis=2).astype(np.float64)
    alpha = np.clip(d / max(d.max(), 1) * 255, 0, 255).astype(np.uint8)
    h, w = alpha.shape

    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    for path, ink in ((MARK_DARK, (79, 70, 229)), (MARK_LIGHT, (255, 255, 255))):
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2] = ink
        rgba[:, :, 3] = alpha
        Image.fromarray(rgba, 'RGBA').save(path)
        print(f'wrote {path.relative_to(REPO)} ({w}x{h})')


def normalize(apply: bool, verbose: bool) -> tuple[int, int]:
    template = load_template()
    marks = {
        'dark': Image.open(MARK_DARK).convert('RGBA'),
        'light': Image.open(MARK_LIGHT).convert('RGBA'),
    }
    alpha = np.asarray(marks['dark'])[:, :, 3]
    mark_w, mark_h = marks['dark'].size
    touched = 0
    total = 0

    for path in sorted(SLIDES_DIR.glob('slide-*.png')):
        total += 1
        img = Image.open(path).convert('RGB')
        w, h = img.size
        actions: list[str] = []
        scores: list[str] = []

        # Survey every corner before touching anything; erasing as we go would
        # hide a copy from the checks that follow.
        found_marks: dict[str, tuple[int, int, int, int]] = {}
        for corner, frac in CORNERS.items():
            found, score = find_mark(img, corner_box(img.size, frac), template)
            scores.append(f'{corner}={score:.2f}')
            if found is not None:
                found_marks[corner] = found

        slots = {}
        for name, fx, fy in [('bottom-left', ANCHOR_X, None), *FALLBACK_ANCHORS]:
            x = round(w * fx)
            y = (
                round(h * fy) if fy is not None
                else h - round(h * ANCHOR_BOTTOM) - mark_h
            )
            slots[name] = (x, y, x + mark_w, y + mark_h)

        # Occupancy is only ever measured where no mark was found. A slot that
        # already carries one is usable by definition, and testing it would
        # measure the mark (or the seam left by erasing it) rather than the
        # artwork underneath.
        def free(name: str) -> bool:
            if name in found_marks:
                return True
            spread = slot_spread(img, slots[name])
            scores.append(f'slot:{name}={spread:.0f}')
            return spread <= FREE_SLOT_SPREAD

        # Bottom-left is the house style. Some slides genuinely cannot take it
        # there — a screenshot or a full-width card runs through that corner —
        # so those fall back to the first usable alternative, which is what the
        # deck author did by hand on exactly those slides.
        slot_name = None
        if free('bottom-left'):
            slot_name = 'bottom-left'
        else:
            for name, _, _ in FALLBACK_ANCHORS:
                if name in found_marks:
                    slot_name = name
                    break
            if slot_name is None:
                for name, _, _ in FALLBACK_ANCHORS:
                    if free(name):
                        slot_name = name
                        break
        if slot_name is None:
            print(f'{path.stem}: SKIPPED — no free slot for the mark')
            continue

        target_box = slots[slot_name]
        target_x, target_y = target_box[0], target_box[1]
        contrast = contrast_at(img, target_box, alpha)

        for corner, box in found_marks.items():
            if corner != slot_name:
                actions.append(f'moved from {corner}')
        if slot_name not in found_marks and not actions:
            actions.append('added missing mark')
        elif slot_name in found_marks:
            if found_marks[slot_name][:2] != (target_x, target_y):
                actions.append(
                    f'realigned from {found_marks[slot_name][0]},'
                    f'{found_marks[slot_name][1]}'
                )
            elif contrast < MIN_CONTRAST:
                actions.append(f'recoloured (contrast {contrast:.0f})')

        if not actions:
            note = '' if slot_name == 'bottom-left' else f' (at {slot_name})'
            print(f'{path.stem}: already correct{note}')
            if verbose:
                print(f'            scores: {" ".join(scores)} contrast={contrast:.0f}')
            continue

        clean = img.copy()
        for box in found_marks.values():
            erase(clean, box)
        variant = 'dark' if is_light(clean, target_box) else 'light'
        stamped = clean.convert('RGBA')
        stamped.alpha_composite(marks[variant], (target_x, target_y))
        if apply:
            stamped.convert('RGB').save(path)

        touched += 1
        print(f'{path.stem}: {"; ".join(actions)} -> {slot_name} {variant}')
        if verbose:
            print(f'            scores: {" ".join(scores)} contrast={contrast:.0f}')

    return touched, total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true',
                        help='rewrite the slide PNGs in place')
    parser.add_argument('--extract', action='store_true',
                        help='re-lift the brand marks off the deck first')
    parser.add_argument('--verbose', action='store_true',
                        help='print per-corner match scores')
    args = parser.parse_args()

    if args.extract:
        extract_marks()
    if not MARK_DARK.exists() or not MARK_LIGHT.exists():
        sys.exit('brand marks missing — run with --extract first')

    touched, total = normalize(args.apply, args.verbose)
    verb = 'fixed' if args.apply else 'would fix'
    print(f'\n{verb} {touched} of {total} slides')


if __name__ == '__main__':
    main()
