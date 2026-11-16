"""The router prefix short-circuit gives the same routing answers as FastAPI."""

from fastapi import APIRouter, FastAPI, WebSocket
from fastapi import routing as fastapi_routing
from fastapi.testclient import TestClient
from starlette.routing import Match

from src.core import routing_perf
from src.core.routing_perf import install_router_prefix_short_circuit


def _app() -> FastAPI:
    app = FastAPI()
    inner = APIRouter()

    @inner.get("/{item_id}")
    async def item(item_id: str):
        return {"item": item_id}

    @inner.get("")
    async def items():
        return {"items": True}

    middle = APIRouter()
    middle.include_router(inner, prefix="/items")

    @middle.get("/ping")
    async def ping():
        return {"ping": True}

    @middle.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text("hi")
        await websocket.close()

    other = APIRouter()

    @other.get("/other/{x}")
    async def other_route(x: str):
        return {"other": x}

    app.include_router(middle, prefix="/api/v1")
    app.include_router(other)  # no prefix: never short-circuited

    return app


def test_installs_once_and_keeps_routing_answers():
    assert install_router_prefix_short_circuit() is True
    assert install_router_prefix_short_circuit() is True  # idempotent
    assert getattr(fastapi_routing._IncludedRouter.matches, "_lh_prefix_short_circuit", False)

    client = TestClient(_app())
    assert client.get("/api/v1/items/42").json() == {"item": "42"}
    assert client.get("/api/v1/items").json() == {"items": True}
    assert client.get("/api/v1/ping").json() == {"ping": True}
    assert client.get("/other/x").json() == {"other": "x"}
    assert client.get("/api/v2/items/42").status_code == 404
    assert client.get("/nope").status_code == 404
    # Trailing-slash redirects still find the route behind the prefix.
    assert client.get("/api/v1/ping/", follow_redirects=False).status_code == 307
    with client.websocket_connect("/api/v1/ws") as ws:
        assert ws.receive_text() == "hi"


def test_branch_outside_the_path_answers_none_without_walking(monkeypatch):
    install_router_prefix_short_circuit()
    app = _app()
    branch = next(
        r for r in app.router.routes
        if isinstance(r, fastapi_routing._IncludedRouter) and r.include_context.prefix
    )
    walked = []
    original = fastapi_routing._IncludedRouter._match

    def counting_match(self, scope):
        walked.append(scope["path"])
        return original(self, scope)

    monkeypatch.setattr(fastapi_routing._IncludedRouter, "_match", counting_match)
    outside = {"type": "http", "path": "/elsewhere", "root_path": "", "method": "GET"}
    assert branch.matches(outside) == (Match.NONE, {})
    assert walked == []  # answered from the prefix alone
    inside = {"type": "http", "path": "/api/v1/ping", "root_path": "", "method": "GET"}
    match, _ = branch.matches(inside)
    assert match == Match.FULL and walked == ["/api/v1/ping"]
    # Non-request scopes go to FastAPI's own matcher untouched.
    lifespan = {"type": "lifespan", "path": "/elsewhere", "root_path": ""}
    branch.matches(lifespan)
    assert walked[-1] == "/elsewhere"


def test_missing_internals_leave_routing_alone(monkeypatch):
    monkeypatch.delattr(fastapi_routing, "_IncludedRouter")
    assert routing_perf.install_router_prefix_short_circuit() is False
