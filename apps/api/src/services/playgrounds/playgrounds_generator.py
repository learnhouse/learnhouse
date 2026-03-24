from typing import Optional, AsyncGenerator
from uuid import uuid4
import logging
import redis
import json
import asyncio

from config.config import get_learnhouse_config
from src.services.ai.base import get_gemini_client
from src.services.playgrounds.schemas.playgrounds_generator import (
    PlaygroundContext,
    PlaygroundSessionData,
    PlaygroundMessage,
)

logger = logging.getLogger(__name__)

LH_CONFIG = get_learnhouse_config()

PLAYGROUND_SESSION_KEY = "playground_session:{session_uuid}"
SESSION_TTL = 2160000  # 25 days
MAX_ITERATIONS = 10


def get_redis_connection():
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string
    if redis_conn_string:
        try:
            return redis.from_url(redis_conn_string)
        except Exception as e:
            logger.error("Failed to connect to Redis: %s", e, exc_info=True)
    return None


def get_playground_session(session_uuid: str) -> Optional[PlaygroundSessionData]:
    r = get_redis_connection()
    if not r:
        return None
    try:
        key = PLAYGROUND_SESSION_KEY.format(session_uuid=session_uuid)
        session_data = r.get(key)
        if session_data:
            if isinstance(session_data, bytes):
                data = json.loads(session_data.decode("utf-8"))
            else:
                data = json.loads(session_data)
            return PlaygroundSessionData(**data)
    except Exception as e:
        logger.error("Failed to get Playground session: %s", e, exc_info=True)
    return None


def create_playground_session(
    playground_uuid: str,
    context: PlaygroundContext,
) -> PlaygroundSessionData:
    session_uuid = f"pg_{uuid4()}"
    session = PlaygroundSessionData(
        session_uuid=session_uuid,
        playground_uuid=playground_uuid,
        iteration_count=0,
        max_iterations=MAX_ITERATIONS,
        message_history=[],
        current_html=None,
        context=context,
    )
    save_playground_session(session)
    return session


def save_playground_session(session: PlaygroundSessionData) -> bool:
    r = get_redis_connection()
    if not r:
        return False
    try:
        key = PLAYGROUND_SESSION_KEY.format(session_uuid=session.session_uuid)
        r.setex(key, SESSION_TTL, json.dumps(session.model_dump()))
        return True
    except Exception as e:
        logger.error("Failed to save Playground session: %s", e, exc_info=True)
        return False


def build_playground_system_prompt(
    context: PlaygroundContext,
    course_context: Optional[str] = None,
) -> str:
    base_prompt = f"""You are an expert interactive content creator for educational playgrounds.

CONTEXT:
- Playground: {context.playground_name}
- Description: {context.playground_description}"""

    if course_context and context.course_name:
        base_prompt += f"""

COURSE CONTEXT:
The following content is from the course "{context.course_name}":

{course_context}

Use this content as the foundation for the interactive experience when relevant."""

    base_prompt += """

You create standalone interactive HTML learning widgets — focused, contained interactive environments that teach or reinforce a concept. Think card-based UIs, quiz panels, simulation panels, interactive diagrams — NOT full websites or landing pages.

CRITICAL DESIGN PHILOSOPHY:
- Think WIDGET, not website. Your output is a contained interactive environment embedded in a page.
- Use a clean, card-based or panel-based layout. Everything should feel like a purposeful learning tool.
- NO navigation bars, NO hero sections, NO footers, NO marketing copy, NO "Sign up" buttons.
- Avoid a website-like layout with a top navbar, multiple sections, and a footer — that is NOT what this is.
- The content should fill the iframe naturally with a single focused interactive experience.
- Prefer a neutral or light background (white, gray-50, slate-50) with one or two accent colors max.

DESIGN RULES:
1. Generate a COMPLETE, self-contained HTML document
2. ALWAYS use Tailwind CSS via CDN for styling
3. Use LIGHT backgrounds — no dark full-page themes
4. Centered, card-style layout — the interactive content is the star
5. Responsive with proper spacing, rounded corners, subtle shadows on cards
6. Highly interactive — buttons, sliders, inputs, drag, click, animations, visual feedback
7. Clear instructions so learners know what to do

GOOD EXAMPLES (build these kinds of things):
- Flashcard deck with smooth flip animation and progress counter
- Multiple-choice quiz with instant feedback, explanations, and score tracker
- Drag-and-drop sorting, ranking, or matching exercise
- Interactive slider to explore a concept (change a variable, see the live effect on a chart or diagram)
- Step-by-step simulation with Next/Back controls and progress indicator
- Math or science formula explorer with live calculation and visual output
- Memory card matching game
- Timeline with clickable events that reveal detail panels
- Fill-in-the-blank or word scramble with hints
- Physics simulation (pendulum, projectile, gravity, collisions)
- Chemistry molecule builder or periodic table explorer
- Concept map or mind map with expandable/collapsible nodes
- Progress-tracked multi-step learning flow with completion state
- Animated bar, pie, or line chart that responds to user input
- Countdown timer quiz — answer before time runs out
- Word cloud that builds as user types associations
- Venn diagram with draggable items to sort into regions
- Hotspot image — click zones on a diagram to reveal labels/info
- Code snippet runner with editable input and live output preview
- Branching scenario / decision tree — choose your path story
- Kanban-style board to categorize concepts into columns
- Animated number line or coordinate plane explorer
- Spinning wheel or random picker for classroom activities
- True/False card swiper (Tinder-style) for quick review
- Analogy builder — match left column to right column
- Fraction or percentage visual (pie slice, bar fill) that updates live
- Color mixer / RGB/HSL explorer with live preview
- Sound frequency or wave visualizer with sliders
- Typing speed / accuracy mini-game
- Vocabulary builder — definition shown, user types the word
- Binary / hex / decimal converter with animated bit display
- Gravity or orbital simulation with adjustable mass/speed
- Anatomy diagram with labeled clickable regions
- Budget / resource allocation tool with live bar charts
- Reaction-time game to illustrate human reflex concepts
- Morse code encoder/decoder with audio playback
- World map quiz — click the correct country
- Crossword puzzle generator from given word list
- Matching pairs: term on left, definition on right, draw connecting lines

BAD EXAMPLES (do NOT build these):
- A website with a hero, sections and a footer
- A landing page or marketing page
- A multi-page app with routing
- A dashboard with a left sidebar nav

AVAILABLE LIBRARIES (use via CDN when needed):
- Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>
- Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
- D3.js: <script src="https://d3js.org/d3.v7.min.js"></script>
- Matter.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>
- P5.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
- Anime.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"></script>
- GSAP: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.4/gsap.min.js"></script>
- Confetti: <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.0/dist/confetti.browser.min.js"></script>
- KaTeX: <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
- SortableJS: <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>
- Mermaid: <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>

OUTPUT FORMAT:
Return ONLY the HTML code, starting with <!DOCTYPE html> and ending with </html>.
Do not include any explanations, markdown code blocks, or other text outside the HTML."""

    return base_prompt


async def generate_playground_stream(
    prompt: str,
    session: PlaygroundSessionData,
    gemini_model_name: str = "gemini-2.0-flash",
    current_html: Optional[str] = None,
    course_context: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    try:
        client = get_gemini_client()

        contents = []

        system_prompt = build_playground_system_prompt(session.context, course_context)
        contents.append({"role": "user", "parts": [{"text": system_prompt}]})
        contents.append(
            {
                "role": "model",
                "parts": [
                    {
                        "text": "I understand. I'll create interactive, self-contained HTML content for educational playgrounds. I'll output only valid HTML code."
                    }
                ],
            }
        )

        for msg in session.message_history:
            contents.append({"role": msg.role, "parts": [{"text": msg.content}]})

        if current_html:
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
            contents.append({"role": "user", "parts": [{"text": prompt}]})

        response = client.models.generate_content_stream(
            model=gemini_model_name, contents=contents
        )

        full_response = ""
        for chunk in response:
            if chunk.text:
                full_response += chunk.text
                yield chunk.text
                await asyncio.sleep(0.01)

        session.message_history.append(
            PlaygroundMessage(role="user", content=prompt)
        )
        session.message_history.append(
            PlaygroundMessage(role="model", content=full_response)
        )
        session.current_html = extract_html_from_response(full_response)
        session.iteration_count += 1

        if len(session.message_history) > 12:
            session.message_history = session.message_history[-12:]

        save_playground_session(session)

    except Exception as e:
        yield f"Error: {str(e)}"


def extract_html_from_response(response: str) -> str:
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
    return response.strip()
