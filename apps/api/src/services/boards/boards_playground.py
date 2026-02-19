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
    return f"""You are an expert interactive content creator specializing in MULTIPLAYER / COLLABORATIVE experiences for educational boards.

CONTEXT:
- Board: {context.board_name}
- Description: {context.board_description}

YOU ARE CREATING A COLLABORATIVE, MULTIPLAYER INTERACTIVE ELEMENT.
Multiple users will interact with this element simultaneously in real-time on a shared board.

SHARED STATE API — window.boardState:
The generated HTML has access to a real-time shared state API. ALL state that should be visible to other users MUST go through this API.

- boardState.get(key) — get a shared value
- boardState.set(key, value) — set a value (synced to all users instantly)
- boardState.on(key, callback) — listen for changes: callback(newValue, key). Returns an unsubscribe function.
- boardState.getAll() — get all shared state as a plain object
- boardState.getMyself() — get current user as {{name, color}}

HOW MULTIPLAYER WORKS:
Each user has a pre-loaded identity (name + color) accessible via boardState.getMyself().
There is NO automatic user list — your generated code manages participants itself.
When the experience loads, show a "Join" button. When clicked, add the user to a shared players list:

Example join flow:
  var me = boardState.getMyself();
  var players = boardState.get('players') || [];
  players.push({{ name: me.name, color: me.color }});
  boardState.set('players', players);

Then listen for changes:
  boardState.on('players', function(list) {{ /* re-render player list */ }});

This way each user explicitly joins, and the player list syncs to everyone via shared state.

IMPORTANT: You MUST wait for the state to be ready before using it:
window.addEventListener('boardStateReady', function() {{
  // Initialize your app here
  // Show a "Join" button or auto-join the user
}});

DESIGN RULES:
1. Generate a COMPLETE, self-contained HTML document
2. ALWAYS use Tailwind CSS via CDN for styling
3. Use LIGHT backgrounds (white, gray-50) — no dark themes
4. Design as an embedded widget/component, NOT a full page
5. Keep it responsive and sized to fit its container
6. ALWAYS design for multiplayer — show each user's contributions with their name/color
7. ALWAYS include a join mechanism — users must explicitly enter/join before participating
8. Use clean, modern UI with proper spacing, rounded corners, shadows
9. Include clear instructions for users on how to interact

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

EXAMPLES OF COLLABORATIVE EXPERIENCES:
- Live polls/voting with real-time results
- Multiplayer quizzes with leaderboards
- Shared whiteboards/drawing canvases
- Collaborative brainstorming boards
- Real-time games (tic-tac-toe, trivia, word games)
- Shared timers/counters
- Collaborative sorting/ranking exercises
- Live reaction boards

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
                        "text": "I understand. I'll create collaborative, multiplayer interactive HTML content that uses window.boardState for real-time shared state. I'll output only valid HTML code."
                    }
                ],
            }
        )

        for msg in session.message_history:
            contents.append({"role": msg.role, "parts": [{"text": msg.content}]})

        if current_html and session.iteration_count > 0:
            iteration_prompt = f"""The user wants to modify the existing collaborative element.

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
