from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_real_client_ip(request: Request) -> str:
    """A6 fix (30 Sep 2026 security/DPDP review): the request path is
    browser -> Vercel (a server-side rewrite proxy, see frontend/next.config.js
    -- not a client-side redirect) -> Render's own front door -> this
    container. request.client.host is only ever Render's ingress hop, which
    is effectively the same for all traffic -- keying rate limits on it means
    the whole platform shares one bucket (confirmed: this is almost certainly
    why multi-account testing kept tripping the login limit even across
    different accounts/browsers).

    Vercel's rewrite proxy sets X-Forwarded-For to the IP it actually saw the
    browser connect from when proxying to an external destination -- it does
    not forward a client-supplied value for that hop unmodified, so the
    *first* entry in the header is the real, trustworthy visitor IP; Render's
    own front door appends its own hop after that. Falls back to
    request.client.host (via get_remote_address) if the header is ever
    absent entirely -- local dev and direct-to-backend calls that never went
    through Vercel.
    """
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop
    return get_remote_address(request)


limiter = Limiter(key_func=get_real_client_ip, default_limits=["200/minute"])
