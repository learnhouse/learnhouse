"""Rename paymentsmodenum to paymentsmodeenum

The original ENUM type was created as 'paymentsmodenum' but SQLAlchemy
autoderives the type name from the PaymentsModeEnum class as
'paymentsmodeenum', so every INSERT/UPDATE to paymentsconfig fails with
DatatypeMismatchError.

Revision ID: c1d2e3f4a5b6
Revises: a8b9c0d1e2f3
Create Date: 2026-05-26
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'a8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLModel.create_all may have created an orphan 'paymentsmodeenum' on DBs
    # bootstrapped before the original (typo) migration. Drop it if unused,
    # then rename the real type. No-op on DBs already at the target state.
    op.execute(
        """
        DO $$
        DECLARE
          old_exists BOOLEAN;
          new_exists BOOLEAN;
          new_in_use BOOLEAN;
        BEGIN
          SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'paymentsmodenum') INTO old_exists;
          SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'paymentsmodeenum') INTO new_exists;
          IF new_exists THEN
            SELECT EXISTS(
              SELECT 1 FROM information_schema.columns
              WHERE udt_name = 'paymentsmodeenum'
            ) INTO new_in_use;
            IF NOT new_in_use AND old_exists THEN
              DROP TYPE paymentsmodeenum;
              ALTER TYPE paymentsmodenum RENAME TO paymentsmodeenum;
            ELSIF new_in_use AND old_exists THEN
              RAISE EXCEPTION
                'Both paymentsmodenum and paymentsmodeenum exist and paymentsmodeenum is in use — manual intervention required';
            END IF;
          ELSIF old_exists THEN
            ALTER TYPE paymentsmodenum RENAME TO paymentsmodeenum;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS(SELECT 1 FROM pg_type WHERE typname = 'paymentsmodeenum')
             AND NOT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'paymentsmodenum') THEN
            ALTER TYPE paymentsmodeenum RENAME TO paymentsmodenum;
          END IF;
        END $$;
        """
    )
