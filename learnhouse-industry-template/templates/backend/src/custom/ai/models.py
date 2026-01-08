def get_industry_model(industry: str) -> str:
    # Override per-industry later. Default to a cost-effective general model.
    return "gpt-4o-mini"
