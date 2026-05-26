"""Merge heads

Revision ID: e6f7a8b9c0d1
Revises: c1d2e3f4a5b6, d3e4f5a6b7c8, n4o5p6q7r8s9
Create Date: 2026-05-26
"""
from typing import Sequence, Union


revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = (
    'c1d2e3f4a5b6',
    'd3e4f5a6b7c8',
    'n4o5p6q7r8s9',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
