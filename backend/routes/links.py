"""Web links into the app, for places that only keep http(s) links.

``http://127.0.0.1:17493/open/captures?capture=<id>`` redirects to
``herga://captures?capture=<id>``, which the app opens (deep_link.rs).
Review docs strip custom-scheme links, but keep these.
"""

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

router = APIRouter()


@router.get("/open/{route:path}")
async def open_in_app(route: str, request: Request):
    query = request.url.query
    return RedirectResponse(f"herga://{route}" + (f"?{query}" if query else ""), status_code=302)
