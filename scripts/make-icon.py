#!/usr/bin/env python3
"""Draw the Nkana marketplace icon (a woven basket) as icon.png.

Kept as a script so the icon can be regenerated or tweaked rather than being an
opaque binary.  Requires Pillow.  Output is 256x256 PNG, which satisfies the
marketplace minimum of 128x128 (256 is the recommended size for Retina).
"""
from PIL import Image, ImageDraw

S = 4  # supersample factor; the image is drawn big and downscaled for smooth edges
W = 256 * S

BG = (34, 39, 46, 255)  # slate, sits well on both light and dark VS Code themes
BASKET = (232, 181, 99, 255)  # warm ochre
WEAVE = (168, 118, 52, 255)  # darker ochre for the weave lines

TOP_Y = 118 * S
BOT_Y = 206 * S
TOP_HALF = 100 * S
BOT_HALF = 76 * S


def half_width(y: float) -> float:
    """Half-width of the basket at height `y` — the body tapers inward."""
    t = (y - TOP_Y) / (BOT_Y - TOP_Y)
    t = min(max(t, 0.0), 1.0)
    return TOP_HALF + (BOT_HALF - TOP_HALF) * t


def main() -> None:
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background tile.
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=52 * S, fill=BG)

    # Basket body: a trapezoid (all four corners, so it does not close with a
    # stray diagonal) with a rounded foot.
    d.polygon(
        [
            (W / 2 - TOP_HALF, TOP_Y),
            (W / 2 + TOP_HALF, TOP_Y),
            (W / 2 + half_width(BOT_Y), BOT_Y),
            (W / 2 - half_width(BOT_Y), BOT_Y),
        ],
        fill=BASKET,
    )
    d.rounded_rectangle(
        [W / 2 - BOT_HALF, BOT_Y - 14 * S, W / 2 + BOT_HALF, BOT_Y + 10 * S],
        radius=12 * S,
        fill=BASKET,
    )

    # Weave: horizontal bands, each clipped to the body at its own height.
    for i in range(1, 5):
        y = TOP_Y + (BOT_Y - TOP_Y) * i / 5
        h = half_width(y) - 8 * S
        d.line([(W / 2 - h, y), (W / 2 + h, y)], fill=WEAVE, width=5 * S)

    # Weave: vertical stakes, leaning inward with the taper.
    for dx in (-52, -18, 18, 52):
        d.line(
            [
                (W / 2 + dx * S, TOP_Y + 6 * S),
                (W / 2 + dx * S * 0.76, BOT_Y - 8 * S),
            ],
            fill=WEAVE,
            width=5 * S,
        )

    # Rim, then the handle arch above it.
    d.line(
        [(W / 2 - 104 * S, TOP_Y), (W / 2 + 104 * S, TOP_Y)],
        fill=BASKET,
        width=14 * S,
    )
    d.arc(
        [W / 2 - 62 * S, 54 * S, W / 2 + 62 * S, 142 * S],
        start=180,
        end=360,
        fill=BASKET,
        width=13 * S,
    )

    img.resize((256, 256), Image.LANCZOS).save("icon.png")
    print("wrote icon.png (256x256)")


if __name__ == "__main__":
    main()
