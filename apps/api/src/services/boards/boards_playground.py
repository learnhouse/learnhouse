from typing import Optional, AsyncGenerator
from uuid import uuid4
import redis
import json
import asyncio

from config.config import get_learnhouse_config
from src.services.ai.base import get_gemini_client
from src.services.boards.schemas.boards_playground import (
    BoardsPlaygroundContext,
    BoardsPlaygroundSessionData,
    BoardsPlaygroundMessage,
)

LH_CONFIG = get_learnhouse_config()

BOARDS_PLAYGROUND_SESSION_KEY = "boards_playground_session:{session_uuid}"
SESSION_TTL = 2160000  # 25 days
MAX_ITERATIONS = 6


def get_redis_connection():
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string
    if redis_conn_string:
        try:
            return redis.from_url(redis_conn_string)
        except Exception as e:
            print(f"Failed to connect to Redis: {e}")
    return None


def get_boards_playground_session(session_uuid: str) -> Optional[BoardsPlaygroundSessionData]:
    r = get_redis_connection()
    if not r:
        return None
    try:
        key = BOARDS_PLAYGROUND_SESSION_KEY.format(session_uuid=session_uuid)
        session_data = r.get(key)
        if session_data:
            if isinstance(session_data, bytes):
                data = json.loads(session_data.decode("utf-8"))
            else:
                data = json.loads(session_data)
            return BoardsPlaygroundSessionData(**data)
    except Exception as e:
        print(f"Failed to get Boards Playground session: {e}")
    return None


def create_boards_playground_session(
    block_uuid: str,
    board_uuid: str,
    context: BoardsPlaygroundContext,
) -> BoardsPlaygroundSessionData:
    session_uuid = f"pg_{uuid4()}"
    session = BoardsPlaygroundSessionData(
        session_uuid=session_uuid,
        block_uuid=block_uuid,
        board_uuid=board_uuid,
        iteration_count=0,
        max_iterations=MAX_ITERATIONS,
        message_history=[],
        current_html=None,
        context=context,
    )
    save_boards_playground_session(session)
    return session


def save_boards_playground_session(session: BoardsPlaygroundSessionData) -> bool:
    r = get_redis_connection()
    if not r:
        return False
    try:
        key = BOARDS_PLAYGROUND_SESSION_KEY.format(session_uuid=session.session_uuid)
        r.setex(key, SESSION_TTL, json.dumps(session.model_dump()))
        return True
    except Exception as e:
        print(f"Failed to save Boards Playground session: {e}")
        return False


def build_boards_playground_system_prompt(context: BoardsPlaygroundContext) -> str:
    return f"""You are an expert interactive content creator for educational boards.

CONTEXT:
- Board: {context.board_name}
- Description: {context.board_description}

You create standalone interactive HTML elements — widgets, visualizations, mini-apps, simulations, and educational tools that run entirely in the browser.

DESIGN RULES:
1. Generate a COMPLETE, self-contained HTML document
2. ALWAYS use Tailwind CSS via CDN for styling
3. Use LIGHT backgrounds (white, gray-50) — no dark themes
4. Design as an embedded widget/component, NOT a full page
5. Keep it responsive and sized to fit its container (use 100% width/height on html and body)
6. Use clean, modern UI with proper spacing, rounded corners, shadows
7. Make it interactive and engaging — buttons, inputs, animations, visual feedback
8. Include clear instructions or labels so users know how to interact

AVAILABLE LIBRARIES (use via CDN):
- Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>
- Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
- D3.js: <script src="https://d3js.org/d3.v7.min.js"></script>
- Matter.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>
- P5.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
- Phaser: <script src="https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js"></script>
- Anime.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"></script>
- GSAP: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.4/gsap.min.js"></script>
- Confetti: <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.0/dist/confetti.browser.min.js"></script>
- KaTeX: <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
- SortableJS: <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>
- Three.js: <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
- Mermaid: <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>

EXAMPLES OF INTERACTIVE ELEMENTS:
- Interactive quizzes and flashcards
- Data visualizations and charts
- Physics simulations and animations
- Math equation explorers
- Timelines and flowcharts
- Drawing canvases and sketchpads
- Interactive maps and diagrams
- Code playgrounds and sandboxes
- Sorting and drag-and-drop exercises
- Mini games (memory, word search, puzzles)
- Calculators and converters
- Interactive stories and decision trees

OUTPUT FORMAT:
Return ONLY the HTML code, starting with <!DOCTYPE html> and ending with </html>.
Do not include any explanations, markdown code blocks, or other text outside the HTML."""


async def generate_boards_playground_stream(
    prompt: str,
    session: BoardsPlaygroundSessionData,
    gemini_model_name: str = "gemini-2.0-flash",
    current_html: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    try:
        client = get_gemini_client()

        contents = []

        system_prompt = build_boards_playground_system_prompt(session.context)
        contents.append({"role": "user", "parts": [{"text": system_prompt}]})
        contents.append(
            {
                "role": "model",
                "parts": [
                    {
                        "text": "I understand. I'll create interactive, self-contained HTML content for educational boards. I'll output only valid HTML code."
                    }
                ],
            }
        )

        for msg in session.message_history:
            contents.append({"role": msg.role, "parts": [{"text": msg.content}]})

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
            BoardsPlaygroundMessage(role="user", content=prompt)
        )
        session.message_history.append(
            BoardsPlaygroundMessage(role="model", content=full_response)
        )
        session.current_html = extract_html_from_response(full_response)
        session.iteration_count += 1

        if len(session.message_history) > 12:
            session.message_history = session.message_history[-12:]

        save_boards_playground_session(session)

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
