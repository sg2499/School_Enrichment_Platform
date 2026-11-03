import ipaddress

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import COOKIE_DOMAIN


def _valid_ip(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def _came_in_directly(request: Request) -> bool:
    """True when the browser called this API on Krama's own address
    (api.krama.zetta-metrics.com, #213) rather than through Vercel's rewrite
    (which calls the onrender.com address)."""
    if not COOKIE_DOMAIN:
        return False
    host = (request.headers.get("host") or "").split(":")[0].strip().lower().rstrip(".")
    return host == COOKIE_DOMAIN or host.endswith("." + COOKIE_DOMAIN)


def get_real_client_ip(request: Request) -> str:
    """The address of the person making the request.

    Two ways in (#213, 3 Nov 2026):

    Directly, on api.krama.zetta-metrics.com. Render's front door is
    Cloudflare, which writes the address that connected to it into
    CF-Connecting-IP, replacing any value a client sent. That header is the
    one to trust here. X-Forwarded-For is NOT: Render's proxy keeps whatever
    the client put at the front of it, so its first entry can be anything a
    caller likes.

    Through Vercel's rewrite, on the onrender.com address (the only way in
    before #213, and still the way in until the new addresses are live). The
    A6 fix (30 Sep 2026): request.client.host is only ever Render's ingress
    hop, the same for all traffic, and CF-Connecting-IP is Vercel's server,
    shared by every school. Vercel's rewrite proxy sets X-Forwarded-For to
    the address it saw the browser connect from and does not pass a
    client-supplied value through for that hop, so the first entry is the
    visitor.

    Falls back to request.client.host when neither header is there: local
    development and tests.
    """
    if _came_in_directly(request):
        direct = _valid_ip(request.headers.get("cf-connecting-ip"))
        if direct:
            return direct
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop
    return get_remote_address(request)


def account_or_ip_key(request: Request) -> str:
    """Rate-limit key for a request: the signed-in account when there is one,
    otherwise the address.

    The address is the wrong key for anything a signed-in person does. A
    classroom is thirty or forty students behind one school connection, and
    every page they open makes several requests: at 200 a minute per
    address, a class opening its practice at the start of a period would be
    refused as "too many attempts" while each child had made a handful
    (#213). Per account, 200 a minute is far more than one person uses.

    The account is read from a token whose signature verifies, so a caller
    cannot mint a fresh allowance by sending made-up cookies; without a
    valid token the address is the key, as before.
    """
    # Imported here: security and cookies import config, and this module is
    # imported by main.py before the routes are.
    from app.core.cookies import read_session_token
    from app.core.security import decode_token

    token = None
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        token = read_session_token(request)
    payload = decode_token(token) if token else None
    subject = payload.get("sub") if payload and not payload.get("purpose") else None
    return f"account:{subject}" if subject else get_real_client_ip(request)


limiter = Limiter(key_func=account_or_ip_key, default_limits=["200/minute"])
