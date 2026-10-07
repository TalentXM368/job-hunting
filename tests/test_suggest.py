import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from jobhunt.api import app
from jobhunt.search_service import get_location_suggestions, get_title_suggestions

client = TestClient(app)

def test_title_suggest_mock_on_focus():
    sugs = get_title_suggestions('', True, 6)
    assert len(sugs) == 6

def test_title_suggest_filter():
    sugs = get_title_suggestions('back', True, 6)
    assert any('Backend' in s for s in sugs)

def test_location_suggest_static_plus_live():
    sugs = get_location_suggestions('ban', True, 6)
    assert any('bangalore' in s.lower() for s in sugs)

def test_suggest_api_titles():
    r = client.get('/suggest/titles', params={'q': 'back', 'use_mock': 'true'})
    assert r.status_code == 200
    assert 'suggestions' in r.json()

def test_suggest_api_locations():
    r = client.get('/suggest/locations', params={'q': 'ban', 'use_mock': 'true'})
    assert r.status_code == 200
    assert len(r.json()['suggestions']) <= 6

def test_location_suggest_empty_returns_top():
    sugs = get_location_suggestions('', True, 6)
    assert len(sugs) == 6
