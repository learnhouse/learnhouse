#!/usr/bin/env python
"""Generate the demo bundle's artwork.

The demo is the first thing a prospect sees, so its imagery has to read as one
designed system rather than assorted stock. Generating it gives us that for
free: every thumbnail is drawn from the same palette with the same geometry and
the same margins, and nothing can drift out of style later.

It also settles provenance. Photography would mean licensing, attribution and
(for avatars) either model releases or synthetic faces. These are flat vector
compositions authored here, so the bundle ships art we own outright.

Output is deterministic — same input, same bytes — so re-running this does not
produce a spurious diff. Run it when the palette or compositions change:

    uv run python scripts/build_demo_media.py

The generated .webp files are committed; this script is the source they came
from, not a build step anyone needs to run to use the bundle.
"""

import math
import os

from PIL import Image, ImageDraw

OUT_ROOT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "src", "services", "demo", "bundle", "media",
)

THUMB_SIZE = (1200, 675)  # 16:9, the ratio the catalogue grid crops to
AVATAR_SIZE = (400, 400)
LOGO_SIZE = (512, 512)

# One restrained palette for the whole bundle. Each entry is (deep, mid, light)
# and a course keeps its triple across background, motif and accent so a
# thumbnail reads as a single object rather than three colours in a box.
PALETTES = [
    ((28, 42, 84), (58, 92, 168), (150, 190, 245)),    # indigo
    ((18, 62, 60), (36, 122, 112), (140, 214, 196)),   # teal
    ((78, 38, 74), (140, 68, 128), (232, 168, 214)),   # plum
    ((92, 52, 20), (168, 104, 44), (244, 190, 130)),   # amber
    ((30, 58, 30), (62, 120, 62), (160, 216, 152)),    # moss
    ((72, 28, 36), (146, 60, 74), (240, 160, 172)),    # garnet
]

INK = (14, 18, 30)
PAPER = (247, 248, 251)


def _vertical_gradient(size, top, bottom):
    """A soft field rather than a flat fill — flat blocks look unfinished at
    catalogue size, and a full photo would fight the text over it."""
    width, height = size
    image = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=(
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return image


def _overlay(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def _motif_arcs(draw, size, colour):
    """Concentric arcs sweeping out of the lower-left corner."""
    width, height = size
    for i in range(7):
        radius = int(height * (0.32 + i * 0.20))
        box = (-radius // 2, height - radius // 2, radius, height + radius // 2)
        draw.arc(box, start=270, end=360, fill=colour + (150,), width=14)


def _motif_grid(draw, size, colour):
    """A dot grid fading out across the frame."""
    width, height = size
    step = 58
    for row, y in enumerate(range(int(height * 0.18), height, step)):
        for col, x in enumerate(range(int(width * 0.52), width, step)):
            fade = max(0, 190 - (col * 12) - (row * 6))
            if fade <= 0:
                continue
            r = 7
            draw.ellipse((x - r, y - r, x + r, y + r), fill=colour + (fade,))


def _motif_bars(draw, size, colour):
    """Diagonal bars of varying weight."""
    width, height = size
    x = int(width * 0.46)
    for i, weight in enumerate((26, 14, 40, 10, 22, 16)):
        draw.line(
            [(x, height + 40), (x + int(height * 0.75), -40)],
            fill=colour + (130 if i % 2 else 190,),
            width=weight,
        )
        x += weight + 46


def _motif_rings(draw, size, colour):
    """Offset outline rings."""
    width, height = size
    cx, cy = int(width * 0.74), int(height * 0.48)
    for i in range(5):
        r = 70 + i * 62
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=colour + (170,), width=10)


def _motif_steps(draw, size, colour):
    """A rising stair of blocks."""
    width, height = size
    base_x, base_y = int(width * 0.54), int(height * 0.86)
    for i in range(6):
        w, h = 86, 44 + i * 40
        x = base_x + i * 98
        draw.rectangle((x, base_y - h, x + w, base_y), fill=colour + (120 + i * 20,))


def _motif_waves(draw, size, colour):
    """Stacked sine bands."""
    width, height = size
    for band in range(5):
        offset = int(height * (0.30 + band * 0.13))
        points = []
        for x in range(0, width + 12, 12):
            y = offset + int(math.sin(x / 150 + band) * 26)
            points.append((x, y))
        draw.line(points, fill=colour + (110 + band * 25,), width=9)


MOTIFS = (_motif_arcs, _motif_grid, _motif_bars, _motif_rings, _motif_steps, _motif_waves)


def build_course_thumbnail(index: int, path: str) -> None:
    deep, mid, light = PALETTES[index % len(PALETTES)]
    image = _vertical_gradient(THUMB_SIZE, deep, mid)
    layer = _overlay(THUMB_SIZE)
    MOTIFS[index % len(MOTIFS)](ImageDraw.Draw(layer), THUMB_SIZE, light)
    image = Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")
    image.save(path, "WEBP", quality=82, method=6)


def build_avatar(index: int, path: str) -> None:
    """An abstract portrait: shoulders and a head, no face.

    Deliberately not a photograph and not a generated face. Forty fictional
    learners with real-looking faces is a licensing question at best and
    unsettling at worst, and initials-style abstraction reads correctly at the
    24px the members table renders it at.
    """
    deep, mid, light = PALETTES[index % len(PALETTES)]
    # Rotate the pairing so consecutive avatars in a list do not look identical.
    background = mid if index % 2 else deep
    figure = light if index % 2 else light

    image = Image.new("RGB", AVATAR_SIZE, background)
    draw = ImageDraw.Draw(image)
    width, height = AVATAR_SIZE

    head_r = int(width * (0.155 + (index % 3) * 0.012))
    cx = width // 2
    cy = int(height * 0.40)
    draw.ellipse((cx - head_r, cy - head_r, cx + head_r, cy + head_r), fill=figure)

    body_w = int(width * (0.52 + (index % 4) * 0.03))
    body_top = cy + head_r + int(height * 0.06)
    draw.ellipse(
        (cx - body_w // 2, body_top, cx + body_w // 2, body_top + int(height * 0.62)),
        fill=figure,
    )
    image.save(path, "WEBP", quality=80, method=6)


def build_logo(path: str) -> None:
    """A mark, not a wordmark — no invented company's name rendered as art."""
    deep, mid, light = PALETTES[0]
    image = Image.new("RGB", LOGO_SIZE, PAPER)
    draw = ImageDraw.Draw(image)
    w, h = LOGO_SIZE
    draw.rounded_rectangle((48, 48, w - 48, h - 48), radius=96, fill=deep)
    draw.arc((120, 120, w - 120, h - 120), start=200, end=340, fill=light, width=34)
    draw.ellipse((w // 2 - 34, h // 2 - 34, w // 2 + 34, h // 2 + 34), fill=mid)
    image.save(path, "WEBP", quality=88, method=6)


def build_org_thumbnail(path: str) -> None:
    deep, mid, light = PALETTES[0]
    image = _vertical_gradient(THUMB_SIZE, deep, mid)
    layer = _overlay(THUMB_SIZE)
    _motif_rings(ImageDraw.Draw(layer), THUMB_SIZE, light)
    image = Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")
    image.save(path, "WEBP", quality=82, method=6)


def build_podcast_cover(index: int, path: str) -> None:
    """Square cover art. Podcast players crop to a square, so it is drawn as one."""
    deep, mid, light = PALETTES[(index + 2) % len(PALETTES)]
    size = (600, 600)
    image = _vertical_gradient(size, deep, mid)
    layer = _overlay(size)
    MOTIFS[(index + 3) % len(MOTIFS)](ImageDraw.Draw(layer), size, light)
    image = Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")
    image.save(path, "WEBP", quality=82, method=6)


# Spoken intros for the demo episodes.
#
# Generated with macOS `say` piped through ffmpeg, so the clips are real speech
# with a real waveform — a podcast player showing a flat line for a silent
# placeholder looks broken. The text is ours, the voice is the operating
# system's, and the output is committed, so this generator only needs to run on
# a Mac when the scripts change.
#
#   say -v Daniel -o clip.aiff "…" && ffmpeg -i clip.aiff -b:a 24k -ac 1 clip.mp3
PODCAST_VOICE = "Daniel"
PODCAST_BITRATE = "24k"


def build_episode_audio(text: str, path: str) -> None:
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("say") or not shutil.which("ffmpeg"):
        print(f"  skipping {os.path.basename(path)} — needs macOS `say` and ffmpeg")
        return

    with tempfile.TemporaryDirectory() as tmp:
        aiff = os.path.join(tmp, "clip.aiff")
        subprocess.run(
            ["say", "-v", PODCAST_VOICE, "-o", aiff, text],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", aiff,
                "-ac", "1", "-ar", "22050", "-b:a", PODCAST_BITRATE,
                path,
            ],
            check=True,
            capture_output=True,
        )


COURSE_THUMBNAILS = [
    "onboarding-essentials.webp",
    "communication-at-work.webp",
    "customer-support-fundamentals.webp",
    "product-knowledge.webp",
    "data-literacy.webp",
    "compliance-essentials.webp",
]

AVATAR_COUNT = 24

# Keep in step with the `podcasts` block in bundle/engagement.json.
PODCASTS = [
    (
        "riverbend-briefing",
        [
            ("ep-briefing-1", "This week: the escalation thresholds have changed, and we walk through what that means on a live account."),
            ("ep-briefing-2", "Why the returns figure fell last quarter, and why most of that fall is a processing backlog rather than good news."),
            ("ep-briefing-3", "Two people promised the same last unit. Here is how committed stock actually works."),
            ("ep-briefing-4", "What the spring intake told us about their first fortnight, and the four things we changed as a result."),
        ],
    ),
    (
        "support-notes",
        [
            ("ep-support-1", "The first reply. Acknowledge, restate, commit — and why a time attached is the whole job."),
            ("ep-support-2", "Saying no well. A clear refusal beats a soft maybe, every time."),
            ("ep-support-3", "When it was our mistake: owning it plainly, and fixing the thing before discussing compensation."),
        ],
    ),
    (
        "numbers-plainly",
        [
            ("ep-numbers-1", "An average hides the shape. What the median tells you that the mean will not."),
            ("ep-numbers-2", "Before you believe a number: what is counted, over what period, and did the definition move?"),
            ("ep-numbers-3", "Two things moved together. Here is how to work out whether one caused the other."),
        ],
    ),
]


def main() -> None:
    courses_dir = os.path.join(OUT_ROOT, "courses")
    avatars_dir = os.path.join(OUT_ROOT, "avatars")
    org_dir = os.path.join(OUT_ROOT, "org")
    for directory in (courses_dir, avatars_dir, org_dir):
        os.makedirs(directory, exist_ok=True)

    for index, name in enumerate(COURSE_THUMBNAILS):
        build_course_thumbnail(index, os.path.join(courses_dir, name))

    for index in range(AVATAR_COUNT):
        build_avatar(index, os.path.join(avatars_dir, f"a{index + 1:02d}.webp"))

    build_logo(os.path.join(org_dir, "logo.webp"))
    build_org_thumbnail(os.path.join(org_dir, "thumbnail.webp"))

    podcasts_dir = os.path.join(OUT_ROOT, "podcasts")
    os.makedirs(podcasts_dir, exist_ok=True)
    for index, (show, episodes) in enumerate(PODCASTS):
        build_podcast_cover(index, os.path.join(podcasts_dir, f"{show}.webp"))
        for slug, line in episodes:
            build_episode_audio(line, os.path.join(podcasts_dir, f"{slug}.mp3"))

    total = 0
    for dirpath, _dirs, files in os.walk(OUT_ROOT):
        for name in files:
            total += os.path.getsize(os.path.join(dirpath, name))
    print(f"wrote demo media to {OUT_ROOT} ({total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
