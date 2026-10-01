"""Server-side pagination for list endpoints (1 Oct 2026, first used by the
Practice Tracker).

Until now no list endpoint in this codebase paginated server-side -- even
admin/people's client-side pagination fetches the whole roster first. That
doesn't survive a school with thousands of students per standard, so the
tracker's lists (assignments, a section's students, one assignment's
students, the review queue) all page in the database through this one
helper and return the same envelope:

    {"items": [...], "page": 1, "pageSize": 25, "total": 312, "totalPages": 13}

Offset pagination, deliberately, rather than keyset/cursor: a teacher's
tracker wants "page 4 of 13" and a total count, the result sets are bounded
by one school (thousands of rows, not millions), and every query that uses
this orders by a stable, indexed key with an id tiebreaker so pages never
overlap or skip rows between requests. pageSize is capped at MAX_PAGE_SIZE
so no request can ask for the whole table in one go. A page past the end is
not an error -- it returns an empty `items` with the real `total`, and the
client clamps.
"""
import math
from dataclasses import dataclass

from fastapi import Query

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


@dataclass(frozen=True)
class PageParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: int = Query(1, ge=1, le=100_000),
    pageSize: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> PageParams:
    return PageParams(page=page, page_size=pageSize)


def paginate(query, params: PageParams) -> tuple[list, int]:
    """Runs `query` (already filtered and ordered) for one page. The count
    drops the ORDER BY, which only costs time and never changes a count."""
    total = query.order_by(None).count()
    items = query.offset(params.offset).limit(params.page_size).all()
    return items, total


def page_envelope(items: list, total: int, params: PageParams, **extra) -> dict:
    return {
        "items": items,
        "page": params.page,
        "pageSize": params.page_size,
        "total": total,
        "totalPages": max(1, math.ceil(total / params.page_size)),
        **extra,
    }


def like_pattern(term: str) -> str:
    """A LIKE pattern for a user-typed search term, with the term's own
    % and _ escaped (use with `escape="\\\\"`) so "50%" searches for the
    literal text instead of matching everything."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
