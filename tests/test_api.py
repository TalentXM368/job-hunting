import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from jobhunt.api import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_companies():
    r = client.get("/companies")
    assert r.status_code == 200
    assert "companies" in r.json()


def test_config_defaults():
    r = client.get("/config/defaults")
    assert r.status_code == 200
    assert "filters" in r.json()


def test_search_post_mock_with_title():
    r = client.post("/search", json={"title": "Backend Engineer", "use_mock": True, "locations": ["bangalore"]})
    assert r.status_code == 200
    data = r.json()
    assert "jobs" in data and "meta" in data
    assert "per_board" in data["meta"]
    assert data["meta"]["limit"] == 50


def test_search_get_mock():
    r = client.get("/search", params={"q": "Backend", "use_mock": "true"})
    assert r.status_code == 200
    assert "jobs" in r.json()


def test_search_pagination():
    r = client.post("/search", json={"title": "", "use_mock": True, "limit": 2, "offset": 0, "max_age_days": None, "locations": []})
    assert len(r.json()["jobs"]) <= 2


def test_search_post_distinguishes_omitted_age_from_any_time(monkeypatch):
    calls = []

    def fake_search(**kwargs):
        calls.append(kwargs)
        return {"jobs": [], "meta": {"scanned": 0, "after_title": 0, "total": 0}}

    monkeypatch.setattr("jobhunt.api.search", fake_search)
    assert client.post("/search", json={}).status_code == 200
    assert client.post("/search", json={"max_age_days": None}).status_code == 200

    assert "max_age_days" not in calls[0]
    assert calls[1]["max_age_days"] is None
