"""
Per-track illustrations for nudge emails, drawn as table cells.

Every obvious way to put a picture in an email fails somewhere that matters:
Gmail strips inline ``<svg>`` entirely, and both Gmail and Outlook refuse
``data:`` URIs — so a base64 image renders as a blank gap. A remote ``<img>``
works, but images are blocked by default until the reader clicks "display
images", which is precisely the moment we are trying to earn.

A grid of background-coloured table cells has none of those problems. It is
the oldest trick in HTML email and still the only one that renders identically
in Outlook 2016, Gmail, Apple Mail and every webmail client, with no hosting,
no asset pipeline and nothing to block.

Each motif is an 8x8 bitmap: ``1`` is the track colour, ``2`` a light tint of
it, ``0`` transparent. Shape carries the meaning, so the illustration still
reads if a client drops the colours.
"""

from typing import Final

# Muted enough to sit beside the monochrome layout without fighting the black
# CTA button, distinct enough that six tracks read apart at a glance.
TRACK_COLORS: Final[dict[str, str]] = {
    "activation": "#b45309",
    "content": "#0f766e",
    "audience": "#4338ca",
    "monetization": "#a16207",
    "dormancy": "#57534e",
    "milestone": "#15803d",
    "reactivation": "#be123c",
}

DEFAULT_COLOR = "#3f3f46"

# 8x8, one per track. Read them as pixel art — the shape is the message.
MOTIFS: Final[dict[str, tuple[str, ...]]] = {
    # A plus: make something that isn't there yet.
    "activation": (
        "00022000",
        "00022000",
        "00011000",
        "22111122",
        "22111122",
        "00011000",
        "00022000",
        "00022000",
    ),
    # Stacked bands: chapters and lessons piling up, the last one still faint.
    "content": (
        "00000000",
        "11111111",
        "11111111",
        "00000000",
        "11111111",
        "11111111",
        "00000000",
        "22222222",
    ),
    # A small crowd — three, then two.
    "audience": (
        "00000000",
        "11011011",
        "11011011",
        "00000000",
        "00110110",
        "00110110",
        "00000000",
        "22222222",
    ),
    # A staircase: the tier you are on, and the one above it.
    "monetization": (
        "00000000",
        "00000011",
        "00000011",
        "00002211",
        "00002211",
        "00222211",
        "00222211",
        "22222211",
    ),
    # Two dimmed bars, fading out.
    "dormancy": (
        "00000000",
        "01100110",
        "01100110",
        "01100110",
        "02200220",
        "02200220",
        "00000000",
        "00000000",
    ),
    # A ring: come back around. Left open at top and bottom so it reads as a
    # return rather than a full stop.
    "reactivation": (
        "00022000",
        "02111120",
        "21100112",
        "21000012",
        "21000012",
        "21100112",
        "02111120",
        "00022000",
    ),
    # A filled diamond: something actually happened.
    "milestone": (
        "00011000",
        "00111100",
        "01111110",
        "11111111",
        "11111111",
        "01111110",
        "00111100",
        "00011000",
    ),
}

CELL_PX = 5


def _tint(hex_color: str, amount: float = 0.78) -> str:
    """Mix a colour toward white. Used for the motif's secondary tone."""
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    mix = lambda c: round(c + (255 - c) * amount)  # noqa: E731
    return f"#{mix(r):02x}{mix(g):02x}{mix(b):02x}"


def render_illustration(track: str) -> str:
    """An 8x8 mosaic for a track, as a nested table.

    Returns "" for an unknown track so a new track ships without an
    illustration rather than without an email.
    """
    motif = MOTIFS.get(track)
    if not motif:
        return ""

    solid = TRACK_COLORS.get(track, DEFAULT_COLOR)
    soft = _tint(solid)
    tone = {"1": solid, "2": soft}

    rows = []
    for line in motif:
        cells = []
        for char in line:
            color = tone.get(char)
            # bgcolor as well as the style: Outlook ignores background-color on
            # a td often enough that the attribute is the one doing the work.
            bg = f' bgcolor="{color}"' if color else ""
            style = f"background-color:{color};" if color else ""
            cells.append(
                f'<td width="{CELL_PX}" height="{CELL_PX}"{bg} '
                f'style="width:{CELL_PX}px;height:{CELL_PX}px;{style}'
                'font-size:0;line-height:0;">&nbsp;</td>'
            )
        rows.append(f"<tr>{''.join(cells)}</tr>")

    return (
        '<table role="presentation" aria-hidden="true" cellpadding="0" '
        'cellspacing="0" border="0" align="center" '
        'style="border-collapse:collapse;margin:0 auto 24px auto;">'
        f"{''.join(rows)}"
        "</table>"
    )
