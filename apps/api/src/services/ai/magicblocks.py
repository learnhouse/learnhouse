from typing import Optional, AsyncGenerator
from uuid import uuid4
import logging
import redis
import json
import asyncio

from config.config import get_learnhouse_config
from src.services.ai.base import get_gemini_client
from src.services.ai.schemas.magicblocks import (
    MagicBlockContext,
    MagicBlockSessionData,
    MagicBlockMessage,
)

logger = logging.getLogger(__name__)

LH_CONFIG = get_learnhouse_config()

# Redis key pattern for MagicBlock sessions
MAGICBLOCK_SESSION_KEY = "magicblock_session:{session_uuid}"
# TTL: 25 days in seconds
SESSION_TTL = 2160000
# Maximum iterations per session
MAX_ITERATIONS = 6


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
        context=context
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

IMPORTANT - THIS IS NOT A PAGE:
You are creating an INTERACTIVE ELEMENT that lives inside a content box, NOT a landing page or website.
- Do NOT design it like a page or landing page
- Do NOT use dark backgrounds - use light/white backgrounds
- Do NOT add headers, footers, or page-like navigation
- The element should look like an embedded widget/component
- Keep it focused on a single interactive purpose

REQUIREMENTS:
1. Generate a COMPLETE, self-contained HTML document
2. The content must be interactive and educational, relevant to the course context
3. Make it responsive and fit well within a container/box
4. Include clear instructions for the user on how to interact
5. The content should enhance understanding of the lesson material
6. ALWAYS use Tailwind CSS for styling - create beautiful, clean, modern UI designs
7. Use LIGHT backgrounds (white, gray-50, gray-100) - NO dark backgrounds
8. Use proper spacing, rounded corners, shadows, and pleasant color schemes
9. Ensure excellent visual hierarchy and user experience
10. Design it as a self-contained widget/component, not a full page

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
    current_html: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """
    Generate MagicBlock HTML content with streaming.
    Yields chunks of the response as they arrive.

    Args:
        prompt: The user's request/instruction
        session: The current session data
        gemini_model_name: The Gemini model to use
        current_html: The current HTML content to iterate on (for modifications)
    """
    try:
        client = get_gemini_client()

        # Build conversation contents
        contents = []

        # Add system instruction
        system_prompt = build_magicblock_system_prompt(session.context)
        contents.append({"role": "user", "parts": [{"text": system_prompt}]})
        contents.append({"role": "model", "parts": [{"text": "I understand. I'll create interactive HTML content for educational purposes. I'll output only valid HTML code that's self-contained and ready to render."}]})

        # Add message history
        for msg in session.message_history:
            contents.append({
                "role": msg.role,
                "parts": [{"text": msg.content}]
            })

        # Build the iteration prompt with current HTML context
        if current_html and session.iteration_count > 0:
            iteration_prompt = f"""The user wants to modify the existing interactive element.

CURRENT HTML CODE:
```html
{current_html}
```

USER REQUEST:
{prompt}

Please modify the HTML code above according to the user's request. Output ONLY the complete updated HTML code, starting with <!DOCTYPE html> and ending with </html>. Do not include any explanations."""
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
        session.current_html = extract_html_from_response(full_response)
        session.iteration_count += 1

        # Keep only last 12 messages (6 exchanges)
        if len(session.message_history) > 12:
            session.message_history = session.message_history[-12:]

        save_magicblock_session(session)

    except Exception as e:
        yield f"Error: {str(e)}"


def extract_html_from_response(response: str) -> str:
    """Extract HTML content from the AI response"""
    # If the response is wrapped in code blocks, extract it
    if "```html" in response:
        start = response.find("```html") + 7
        end = response.find("```", start)
        if end != -1:
            return response[start:end].strip()

    if "```" in response:
        start = response.find("```") + 3
        end = response.find("```", start)
        if end != -1:
            return response[start:end].strip()

    # If no code blocks, return the response as is (should be raw HTML)
    return response.strip()
