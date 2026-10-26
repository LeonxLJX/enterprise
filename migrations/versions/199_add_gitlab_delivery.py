"""Add gitlab_delivery, the GitLab event handler's durable dedupe (PLTF-3689).

One GitLab event can reach the handler through more than one hook that
authenticates, and GitLab queues each hook's deliveries separately, so the
copies can arrive minutes apart. The handler claims a sha256 of each
delivery's raw body here before processing it, marks it processed when done,
and ignores a body that is processed or still being processed. A failed
delivery's claim is deleted, and an unfinished claim can be taken again after
a lease, so a resent delivery is processed. Rows are kept for at least 7 days.

Revision ID: 199
Revises: 198
Create Date: 2026-10-20 00:00:00.000000
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '199'
down_revision: str | None = '198'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'gitlab_delivery',
        sa.Column('body_sha256', sa.String(64), primary_key=True),
        sa.Column(
            'received_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        'ix_gitlab_delivery_received_at', 'gitlab_delivery', ['received_at']
    )


def downgrade() -> None:
    op.drop_index('ix_gitlab_delivery_received_at', table_name='gitlab_delivery')
    op.drop_table('gitlab_delivery')
