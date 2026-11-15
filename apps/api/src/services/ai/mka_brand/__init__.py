"""MKA fork: route all LearnHouse AI through the MKA Brand Center MCP.

Enabled iff ``MKA_BRANDCENTER_TOKEN`` is set. Unsetting it restores upstream behavior exactly.
Hooks: ``llm/client.py::_agent`` (augment, toolsets_for) and ``image/generator.py`` (brand_image_prompt).
"""

from src.services.ai.mka_brand.floor import augment
from src.services.ai.mka_brand.images import brand_image_prompt
from src.services.ai.mka_brand.toolset import toolsets_for

__all__ = ["augment", "brand_image_prompt", "toolsets_for"]
