DEFAULT_SYSTEM_PROMPT = """
You are an industry training assistant.
You adapt to the provided industry context, knowledge base, and policies.
Always provide accurate, safe, and compliance-aware guidance based on supplied data.
"""

def get_industry_prompt(industry: str) -> str:
    # Override per-industry later. For now, return a generic prompt.
    return DEFAULT_SYSTEM_PROMPT
