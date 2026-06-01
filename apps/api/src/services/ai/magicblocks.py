from typing import Optional, AsyncGenerator
from uuid import uuid4
import logging
import redis
import json
import asyncio
import time

from config.config import get_learnhouse_config
from src.services.ai.base import get_gemini_client
from src.services.ai.schemas.magicblocks import (
    MagicBlockContext,
    MagicBlockSessionData,
    MagicBlockMessage,
    MagicBlockRevision,
)

logger = logging.getLogger(__name__)

LH_CONFIG = get_learnhouse_config()

# Redis key pattern for MagicBlock sessions
MAGICBLOCK_SESSION_KEY = "magicblock_session:{session_uuid}"
# TTL: 25 days in seconds
SESSION_TTL = 2160000
# Maximum iterations per session
MAX_ITERATIONS = 6
# Maximum revisions to keep per session (caps Redis payload size)
MAX_REVISIONS = 20


def get_redis_connection():
    """Get Redis connection if available"""
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string
    if redis_conn_string:
        try:
            return redis.from_url(redis_conn_string)
        except Exception as e:
            logger.error("Failed to connect to Redis: %s", e, exc_info=True)
    return None


def get_magicblock_session(session_uuid: str) -> Optional[MagicBlockSessionData]:
    """Get an existing MagicBlock session from Redis"""
    r = get_redis_connection()
    if not r:
        return None

    try:
        key = MAGICBLOCK_SESSION_KEY.format(session_uuid=session_uuid)
        session_data = r.get(key)
        if session_data:
            if isinstance(session_data, bytes):
                data = json.loads(session_data.decode('utf-8'))
            else:
                data = json.loads(session_data)
            return MagicBlockSessionData(**data)
    except Exception as e:
        logger.error("Failed to get MagicBlock session: %s", e, exc_info=True)

    return None


def create_magicblock_session(
    block_uuid: str,
    activity_uuid: str,
    context: MagicBlockContext
) -> MagicBlockSessionData:
    """Create a new MagicBlock session"""
    session_uuid = f"mb_{uuid4()}"

    session = MagicBlockSessionData(
        session_uuid=session_uuid,
        block_uuid=block_uuid,
        activity_uuid=activity_uuid,
        iteration_count=0,
        max_iterations=MAX_ITERATIONS,
        message_history=[],
        current_html=None,
        context=context,
        revisions=[],
    )

    save_magicblock_session(session)
    return session


def save_magicblock_session(session: MagicBlockSessionData) -> bool:
    """Save MagicBlock session to Redis with TTL"""
    r = get_redis_connection()
    if not r:
        return False

    try:
        key = MAGICBLOCK_SESSION_KEY.format(session_uuid=session.session_uuid)
        r.setex(key, SESSION_TTL, json.dumps(session.model_dump()))
        return True
    except Exception as e:
        logger.error("Failed to save MagicBlock session: %s", e, exc_info=True)
        return False


def build_magicblock_system_prompt(context: MagicBlockContext) -> str:
    """Build the system prompt for MagicBlock generation"""
    return f"""You are an expert interactive content creator for educational purposes. Your task is to generate self-contained HTML with embedded CSS and JavaScript that creates interactive learning experiences.

CONTEXT:
- Course: {context.course_title}
- Course Description: {context.course_description}
- Current Lesson: {context.activity_name}
- Lesson Content Summary: {context.activity_content_summary}

WHAT YOU ARE BUILDING — AN INTERACTIVE EXPERIENCE:
You are creating a self-contained INTERACTIVE EXPERIENCE that lives inside an embedded content box. Think of it as a playable widget, a manipulable diagram, a mini-simulation, a hands-on exercise — something the learner DOES, not something they read.

It is NOT:
- A website, landing page, or SaaS dashboard
- A marketing card or feature tile
- A document, article, or static slide
- A generic light-gray rounded card with a shadow (the default "AI-looking" output — avoid this)

Do NOT include page chrome: no headers, footers, navigation bars, hero sections, CTAs, branding, or "Learn more" links. The user is already inside a lesson — the experience starts immediately.

Keep it focused on ONE interactive idea, executed well.

REQUIREMENTS:
1. Generate a COMPLETE, self-contained HTML document
2. Interactivity is the point — the learner should manipulate, drag, click, drag sliders, play, experiment, or otherwise DO something. Passive read-only content fails this brief.
3. Educationally relevant to the course context above
4. Responsive — fits well inside a container of variable width
5. Include short, clear instructions for how to interact (one line, not a tutorial)
6. The visual design should match the SUBJECT, not a default template. A physics simulation can be dark with neon trails. A chemistry titration can have lab-style precision. A music exercise can be playful and colorful. A data visualization can be minimal and analytic. Let the topic drive the palette, typography, and motion.
7. Styling: Tailwind via CDN is available and a fine default for layout, but you may ALSO use a `<style>` block with raw CSS — keyframes, gradients, filters, transforms, clip-path, mix-blend-mode, ::before/::after, custom fonts — whenever it makes the experience better. Don't restrict yourself to utility classes if custom CSS serves the design.
8. Dark, light, or themed backgrounds are all allowed — choose what serves the content. Avoid the generic white/gray-50 card aesthetic unless the topic genuinely calls for it.
9. Strong visual hierarchy and tactile feedback (hover states, transitions, sounds via Tone.js if useful, micro-animations on interaction)
10. Self-contained — no external assets beyond the CDN libraries listed below

AVAILABLE LIBRARIES (use via CDN):
You CAN and SHOULD use these libraries when appropriate:

CSS Frameworks:
- Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>

Charts & Data Visualization:
- Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
- D3.js: <script src="https://d3js.org/d3.v7.min.js"></script>
- ApexCharts: <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
- Plotly.js: <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
- ECharts: <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>

Physics & Simulations:
- Matter.js (2D physics): <script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>
- P5.js (creative coding): <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
- Phaser (game engine): <script src="https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js"></script>

Math & Science:
- Math.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.2.1/math.min.js"></script>
- KaTeX (math rendering): <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"> and <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
- MathJax: <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
- Function Plot (math graphs): <script src="https://cdn.jsdelivr.net/npm/function-plot/dist/function-plot.min.js"></script>

Animation:
- Anime.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"></script>
- GSAP: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.4/gsap.min.js"></script>
- Lottie: <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
- Mo.js: <script src="https://cdn.jsdelivr.net/npm/@mojs/core"></script>

3D Graphics:
- Three.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
- Babylon.js: <script src="https://cdn.babylonjs.com/babylon.js"></script>

UI Components:
- SortableJS (drag & drop): <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>
- Interact.js (drag, resize, gestures): <script src="https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js"></script>
- Confetti.js (celebrations): <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.0/dist/confetti.browser.min.js"></script>

Icons (USE THESE — do not invent SVG icons, do not use emoji as UI icons, do not use other icon libraries):
- Phosphor Icons: <script src="https://cdn.jsdelivr.net/npm/phosphor-icons"></script>
  Usage: <i class="ph-house"></i>, <i class="ph-play"></i>, <i class="ph-arrow-right"></i>
  Weights: ph-thin, ph-light, ph-bold, ph-fill, ph-duotone (e.g. <i class="ph-fill ph-heart"></i>)
  Whenever the experience needs an icon (buttons, controls, indicators, decorative accents), pull it from Phosphor. Browse names at https://phosphoricons.com if unsure — common ones include ph-play, ph-pause, ph-arrow-clockwise, ph-check, ph-x, ph-info, ph-question, ph-lightbulb, ph-target, ph-trophy, ph-sparkle.

Code & Syntax:
- Highlight.js: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css"> and <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
- Prism.js: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css"> and <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>

Maps & Geography:
- Leaflet: <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"> and <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

Audio:
- Tone.js (audio synthesis): <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js"></script>
- Howler.js (audio playback): <script src="https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js"></script>

EXAMPLES OF WHAT YOU CAN CREATE:
- Interactive quizzes with immediate feedback
- Data visualizations and animated charts (use Chart.js, D3.js, or ApexCharts)
- Physics simulations (use Matter.js or P5.js for pendulum, projectile motion, collisions, etc.)
- Interactive timelines
- Flashcard systems
- Drag-and-drop exercises
- Interactive diagrams with hover/click information
- Math calculators with step-by-step solutions (use Math.js and KaTeX)
- Memory games related to the content
- Interactive code examples
- 3D visualizations (use Three.js)

OUTPUT FORMAT:
Return ONLY the HTML code, starting with <!DOCTYPE html> and ending with </html>.
Do not include any explanations, markdown code blocks, or other text outside the HTML.
The HTML must be complete and ready to render in an iframe."""


async def generate_magicblock_stream(
    prompt: str,
    session: MagicBlockSessionData,
    gemini_model_name: str = "gemini-2.0-flash",
    current_html: Optional[str] = None,
    style_reference: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Generate MagicBlock HTML content with streaming.
    Yields chunks of the response as they arrive.

    Args:
        prompt: The user's request/instruction
        session: The current session data
        gemini_model_name: The Gemini model to use
        current_html: The current HTML content to iterate on (for modifications)
        style_reference: Optional HTML of another block whose visual design language
            should be matched (palette, typography, spacing, libraries) without
            copying its content.
    """
    try:
        client = get_gemini_client()

        # Build conversation contents
        contents = []

        # Add system instruction
        system_prompt = build_magicblock_system_prompt(session.context)
        contents.append({"role": "user", "parts": [{"text": system_prompt}]})
        contents.append({"role": "model", "parts": [{"text": "I understand. I'll create interactive HTML content for educational purposes. I'll output only valid HTML code that's self-contained and ready to render."}]})

        # If the user pasted a style reference, prime the model with it as a design
        # exemplar BEFORE the actual request so the new block inherits its look.
        if style_reference:
            style_prompt = f"""STYLE REFERENCE — DESIGN LANGUAGE EXEMPLAR:

The user has provided this existing block as a visual design reference. Your next generation MUST match its design language so blocks feel consistent across the course.

MATCH these aspects:
- Color palette (background, accents, text colors)
- Typography (font families, sizes, weights, hierarchy)
- Spacing, padding, border radii, shadows
- Component shapes (cards, pills, buttons, etc.)
- Library choices (e.g. Tailwind config, Chart.js theming, KaTeX usage)
- Overall aesthetic (minimal/playful/data-heavy/etc.)

DO NOT match:
- The actual content, topic, or interaction logic
- Specific text, labels, or example values

REFERENCE BLOCK:
```html
{style_reference}
```

Acknowledge the style and wait for the user's actual request."""
            contents.append({"role": "user", "parts": [{"text": style_prompt}]})
            contents.append({"role": "model", "parts": [{"text": "Understood. I'll match the design language of the reference block — palette, typography, spacing, component shapes, and library choices — while generating entirely new content for the user's request."}]})

        # Add message history
        for msg in session.message_history:
            contents.append({
                "role": msg.role,
                "parts": [{"text": msg.content}]
            })

        # Build the iteration prompt with current HTML context
        if current_html and session.iteration_count > 0:
            iteration_prompt = f"""You are editing an existing interactive element. The user wants a SURGICAL CHANGE, not a redesign.

CURRENT HTML CODE:
```html
{current_html}
```

USER REQUEST:
{prompt}

STRICT EDIT RULES — follow these exactly:
1. Treat the CURRENT HTML CODE as the source of truth. Keep it byte-for-byte identical EXCEPT for the parts the user explicitly asked to change.
2. Do NOT redesign, restyle, refactor, rename, reorganize, or "improve" code that the user did not mention. Resist the urge to clean up.
3. Preserve all existing: layout structure, class names, IDs, color palette, typography, spacing, animations, library choices, comments, and JavaScript logic that is unrelated to the request.
4. If the request is ambiguous, make the SMALLEST possible interpretation. When in doubt, change less.
5. If the user asks to add something, add it without altering the rest. If the user asks to change one element, change ONLY that element.
6. Do not introduce new libraries or CDN scripts unless the request specifically requires capabilities not present in the current code.
7. Keep the same <!DOCTYPE html>, <head>, and <body> structure.

OUTPUT FORMAT:
Output ONLY the complete updated HTML code, starting with <!DOCTYPE html> and ending with </html>. No explanations, no markdown fences, no commentary."""
            contents.append({"role": "user", "parts": [{"text": iteration_prompt}]})
        else:
            # First generation - just use the prompt
            contents.append({"role": "user", "parts": [{"text": prompt}]})

        # Stream Gemini response: run the blocking SDK iterator in a thread and
        # forward each chunk to the async generator via a Queue so callers see
        # incremental output instead of waiting for the full response.
        import threading
        loop = asyncio.get_running_loop()
        _sentinel = object()
        queue: asyncio.Queue = asyncio.Queue()
        _stream_error: list = []

        def _run_stream():
            try:
                resp = client.models.generate_content_stream(
                    model=gemini_model_name,
                    contents=contents,
                )
                for chunk in resp:
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception as exc:
                _stream_error.append(exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _sentinel)

        t = threading.Thread(target=_run_stream, daemon=True)
        t.start()

        full_response = ""
        while True:
            item = await queue.get()
            if item is _sentinel:
                break
            if item.text:
                full_response += item.text
                yield item.text
                await asyncio.sleep(0)

        if _stream_error:
            raise _stream_error[0]

        # Update session after generation completes
        session.message_history.append(MagicBlockMessage(role="user", content=prompt))
        session.message_history.append(MagicBlockMessage(role="model", content=full_response))
        clean_html = extract_html_from_response(full_response)
        session.current_html = clean_html
        session.iteration_count += 1

        # Snapshot this generation as a revision
        session.revisions.append(MagicBlockRevision(
            revision_uuid=f"rev_{uuid4()}",
            prompt=prompt,
            html=clean_html,
            created_at=time.time(),
        ))
        if len(session.revisions) > MAX_REVISIONS:
            session.revisions = session.revisions[-MAX_REVISIONS:]

        # Keep only last 12 messages (6 exchanges)
        if len(session.message_history) > 12:
            session.message_history = session.message_history[-12:]

        save_magicblock_session(session)

    except Exception as e:
        yield f"Error: {str(e)}"


def extract_html_from_response(response: str) -> str:
    """Extract a single HTML document from the AI response.

    Handles markdown code fences and trims to the first complete
    <!DOCTYPE html>...</html> so duplicated documents don't propagate.
    """
    import re

    text = response

    if "```html" in text:
        start = text.find("```html") + 7
        end = text.find("```", start)
        if end != -1:
            text = text[start:end]
    elif "```" in text:
        start = text.find("```") + 3
        end = text.find("```", start)
        if end != -1:
            text = text[start:end]

    doc_start = re.search(r"<!doctype\s+html[^>]*>|<html[\s>]", text, re.IGNORECASE)
    if doc_start and doc_start.start() > 0:
        text = text[doc_start.start():]

    doc_end = re.search(r"</html\s*>", text, re.IGNORECASE)
    if doc_end:
        text = text[: doc_end.end()]

    return text.strip()
