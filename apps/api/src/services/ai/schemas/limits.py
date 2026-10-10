"""Input-size ceilings for AI request schemas.

Every character in these fields ends up in a model prompt, so unbounded
input is unbounded spend. Sized well above real use.
"""

# User-typed chat messages and generation prompts
AI_MESSAGE_MAX_CHARS = 8000
# Larger context blobs (descriptions, summaries, selected text, source material)
AI_CONTEXT_MAX_CHARS = 20000
# Short labels (names, titles, styles, language codes)
AI_LABEL_MAX_CHARS = 500
