"""Audit logging for sensitive actions (2026-08-19 security hardening).

The `audit_logs` table has existed in the schema since Phase 1
(`app/models/models.py`'s `AuditLog`) but nothing ever actually wrote to it
-- this closes that gap. `log_audit_event()` is the single write path every
sensitive action below goes through, so the event shape stays consistent no
matter which endpoint is logging, and it's the source `INCIDENT_RESPONSE.md`
points to for "who did what, when" during an investigation.

Deliberately just `db.add()`, no `db.commit()` of its own: every call site
below sits right next to (usually just before) that action's own commit, so
the audit row is persisted atomically with the action it's recording --
either both land or neither does, rather than a separate round trip that
could record an audit entry for an action that then failed, or vice versa.
"""
import json
from typing import Any

from fastapi import Request
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.models import AuditLog


def log_audit_event(
    db: Session,
    event_type: str,
    *,
    user_id: str | None = None,
    request: Request | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    ip_address = None
    user_agent = None
    if request is not None:
        try:
            ip_address = get_remote_address(request)
        except Exception:
            ip_address = None
        user_agent = request.headers.get("user-agent")

    db.add(
        AuditLog(
            user_id=user_id,
            event_type=event_type,
            event_data_json=json.dumps(details, default=str) if details else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
