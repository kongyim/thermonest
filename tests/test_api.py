import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.models.schemas import Reading


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, mock=True, token="test-bootstrap", origin="http://testserver")
    with TestClient(app) as client:
        yield client


def login(client):
    assert client.get("/bootstrap?key=test-bootstrap", follow_redirects=False).status_code == 303
    client.headers["x-thermonest"] = "1"


def test_session_host_origin_and_websocket_protection(client):
    assert client.get("/api/sensors").status_code == 401
    assert client.get("/bootstrap?key=wrong").status_code == 403
    login(client)
    assert client.get("/bootstrap?key=test-bootstrap").status_code == 403
    assert client.get("/api/health").json()["mock"] is True
    assert client.get("/api/health", headers={"host": "evil.test"}).status_code == 403
    assert client.post("/api/rooms", json={"name": "Room"}, headers={"origin": "https://evil.test"}).status_code == 403
    assert client.get("/api/health", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/readings", headers={"origin": "https://evil.test"}):
            pass
    with client.websocket_connect("/ws/readings", headers={"origin": "http://testserver"}) as ws:
        client.portal.call(client.app.state.manager.publish, {"type": "test"})
        assert ws.receive_json() == {"type": "test"}
        # Force an immediate send after client closes so server exits its send loop.
        ws.close()
        client.portal.call(client.app.state.manager.publish, {"type": "test"})


def test_missing_csrf_header(client):
    login(client)
    del client.headers["x-thermonest"]
    assert client.post("/api/rooms", json={"name": "Room"}).status_code == 403


def test_registration_readings_reconciliation_export_and_delete(client):
    login(client)
    assert (
        client.post("/api/sensors", json={"device_identifier": "invented", "display_name": "Invalid"}).status_code
        == 422
    )
    candidates = client.post("/api/sensors/discover").json()
    room = client.post("/api/rooms", json={"name": "Bedroom"}).json()
    data = {"device_identifier": candidates[0]["device_identifier"], "display_name": "Window", "room_id": room["id"]}
    sensor = client.post("/api/sensors", json=data).json()
    sid = sensor["id"]
    assert client.post("/api/sensors", json=data).status_code == 409
    assert client.patch(f"/api/sensors/{sid}", json={"display_name": None}).status_code == 422
    assert client.patch("/api/settings", json={"sampling_seconds": 1}).status_code == 422
    assert client.patch("/api/settings", json={"theme": "dark"}).json()["theme"] == "dark"
    # Check the real background scheduler writes readings, rather than calling save directly.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if client.get("/api/sensors").json()[0]["last_seen"]:
            break
        time.sleep(0.1)
    assert client.get("/api/sensors").json()[0]["status"] == "Receiving"
    history = client.get(f"/api/sensors/{sid}/readings").json()
    assert history and history[0]["temperature_c"] is not None
    assert client.get("/api/dashboard/summary").json()["online"] == 1
    assert client.get(f"/api/sensors/{sid}/export").text.startswith("timestamp,temperature_c")
    assert client.get(f"/api/sensors/{sid}/readings?start=2025-01-01T00:00:00").status_code == 422
    assert (
        client.patch(f"/api/sensors/{sid}", json={"device_identifier": candidates[1]["device_identifier"]}).status_code
        == 200
    )
    assert client.get(f"/api/sensors/{sid}/readings").json()
    assert client.delete(f"/api/sensors/{sid}").status_code == 204
    assert client.get(f"/api/sensors/{sid}/readings").status_code == 404
    assert client.app.state.db.rows("SELECT * FROM readings") == []


def test_sqlite_migration_restart_and_missing_values(tmp_path):
    from app.storage.database import Database

    db = Database(tmp_path / "test.sqlite3")
    sensor = db.add_sensor({"display_name": "Sensor", "room_id": None, "device_identifier": "uuid"})
    db.add_reading(sensor["id"], Reading(humidity_percent=45))
    assert db.sensor(sensor["id"])["temperature_c"] is None
    db.engine.dispose()
    db = Database(tmp_path / "test.sqlite3")
    assert db.sensor(sensor["id"])["status"] == "Disconnected"
    assert db.sensor(sensor["id"])["humidity_percent"] == 45
    assert db.rows("SELECT * FROM migrations") == [{"version": 1}, {"version": 2}]
    db.engine.dispose()


def test_battery_settings(client):
    login(client)
    settings = client.get("/api/settings").json()
    assert settings["sampling_seconds"] == 300
    assert settings["battery_mode"] == "balanced"
    assert client.patch("/api/settings", json={"battery_mode": "invalid"}).status_code == 422
    assert client.patch("/api/settings", json={"sampling_seconds": 600}).json()["battery_mode"] == "custom"
    settings = client.patch("/api/settings", json={"battery_mode": "balanced"}).json()
    assert settings["sampling_seconds"] == 300
    assert client.patch("/api/settings", json={"battery_mode": "passive"}).json()["battery_mode"] == "passive"
