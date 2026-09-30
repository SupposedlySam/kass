"""Web links redirect to the app's kass:// scheme."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routes.links import router


def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_a_web_link_redirects_to_the_app():
    response = client().get("/open/captures?capture=abc-123", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "kass://captures?capture=abc-123"


def test_a_link_without_a_query_keeps_its_path():
    response = client().get("/open/settings/dictation", follow_redirects=False)
    assert response.headers["location"] == "kass://settings/dictation"
