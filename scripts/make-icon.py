#!/usr/bin/env python3
"""Draw the Creel marketplace icon (a wicker creel) as icon.png.

A creel is the shallow woven basket an angler carries the catch in. The shape
here is chosen to say that and nothing else: a wide, shallow, tapered basket
with a woven lattice over the whole body and a shoulder strap rising from the
rim. Wide-and-shallow plus visible weave is what separates a creel from a
handbag in a 256 px square.

Kept as a script rather than a committed binary so the icon can be tweaked.
Requires Pillow. Output is 256x256 PNG, the Marketplace's recommended size
(128x128 is the minimum).
"""
from PIL import Image, ImageDraw

S = 4  # supersample factor; draw big, downscale once for smooth edges
W = 256 * S

BG = (34, 39, 46, 255)  # slate; sits well on light and dark VS Code themes
WICKER = (232, 181, 99, 255)  # warm ochre
WEAVE = (176, 124, 56, 255)  # darker ochre for the lattice
STRAP = (198, 150, 80, 255)  # tan leather strap

# Geometry, in output pixels before the supersample factor is applied.
CX = 128  # everything is centred on this
TOP_Y = 132
BOT_Y = 208
TOP_HALF = 98  # wider at the rim
BOT_HALF = 80  # narrower at the foot, so the sides taper
FOOT = 9  # how far the rounded foot sticks out below BOT_Y
STRAP_ARC = (26, 74, 230, 234)  # low and wide; the ends hide behind the body


def main() -> None:
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def px(*values):
        """Scale output pixels into supersampled pixels."""
        return [v * S for v in values]

    cx = CX * S
    top_y, bot_y = TOP_Y * S, BOT_Y * S
    top_half, bot_half = TOP_HALF * S, BOT_HALF * S

    # Background tile.
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=52 * S, fill=BG)

    # Shoulder strap first, so the body covers its ends and it reads as passing
    # behind the basket rather than sitting on top like a handle.
    d.arc(px(*STRAP_ARC), start=180, end=360, fill=STRAP, width=9 * S)

    # Body outline: a tapered basket with a rounded foot.
    outline = [
        (cx - top_half, top_y),
        (cx + top_half, top_y),
        (cx + bot_half, bot_y),
        (cx - bot_half, bot_y),
    ]
    foot = [cx - bot_half, bot_y - FOOT * S, cx + bot_half, bot_y + FOOT * S]

    # Fill the body, then build a matching mask to clip the weave to it.
    d.polygon(outline, fill=WICKER)
    d.rounded_rectangle(foot, radius=12 * S, fill=WICKER)

    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)
    md.polygon(outline, fill=255)
    md.rounded_rectangle(foot, radius=12 * S, fill=255)

    # Lattice: two crossing sets of diagonals, clipped to the body. ImageDraw
    # has no clipping of its own, so the weave goes on its own layer and is
    # composited through the mask.
    lattice = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lattice)
    step = 20 * S
    for i in range(-8, 22):
        x = 4 * S + i * step
        ld.line([(x, 100 * S), (x + 150 * S, 245 * S)], fill=WEAVE, width=4 * S)
        ld.line([(x, 245 * S), (x + 150 * S, 100 * S)], fill=WEAVE, width=4 * S)
    img = Image.alpha_composite(
        img, Image.composite(lattice, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask)
    )

    # Rim across the top, flush with the body rather than overhanging, so it
    # reads as the basket's own edge and not a plank resting on it.
    d = ImageDraw.Draw(img)
    d.line(
        [(cx - top_half, top_y), (cx + top_half, top_y)],
        fill=WICKER,
        width=11 * S,
    )

    # A darker line at the foot so the basket looks like it is standing.
    d.line(
        [(cx - bot_half + 6 * S, bot_y + 5 * S), (cx + bot_half - 6 * S, bot_y + 5 * S)],
        fill=WEAVE,
        width=3 * S,
    )

    img.resize((256, 256), Image.LANCZOS).save("icon.png")
    print("wrote icon.png (256x256)")


if __name__ == "__main__":
    main()
