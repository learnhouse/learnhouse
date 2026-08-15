"""Shared readiness check for the opt-in live Ollama tests.

Those suites are meant to skip themselves on any machine that is not set up to
run them. Checking only that the port answers was not enough: Ollama replies to
a request for a model it has not pulled with a 404, which surfaces as a
ModelHTTPError, so anyone running Ollama for something else collected failures
from a suite they never opted into.
"""

import json
import socket
import urllib.request

OLLAMA_HOST = "localhost"
OLLAMA_PORT = 11434
OLLAMA_BASE_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/v1"


def _server_running() -> bool:
    try:
        with socket.create_connection((OLLAMA_HOST, OLLAMA_PORT), timeout=0.5):
            return True
    except OSError:
        return False


def _pulled_models() -> set[str]:
    """Every model name the server has, both qualified and bare."""
    try:
        with urllib.request.urlopen(
            f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags", timeout=2
        ) as response:
            tags = json.loads(response.read())
    except Exception:
        return set()

    names: set[str] = set()
    for model in tags.get("models", []):
        name = model.get("name", "")
        if not name:
            continue
        # Tags come back qualified ("llama3.2:latest"); the environment
        # variables that select a model are usually written without one.
        names.add(name)
        names.add(name.split(":")[0])
    return names


def ollama_ready(model: str) -> bool:
    """Whether a live test against `model` can actually run here."""
    if not _server_running():
        return False
    available = _pulled_models()
    return model in available or model.split(":")[0] in available


def skip_reason(model: str) -> str:
    return (
        f"Ollama not reachable on localhost:{OLLAMA_PORT}, or model {model!r} "
        f"not pulled (ollama pull {model})"
    )
