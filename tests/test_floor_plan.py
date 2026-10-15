import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app
from app.models.schemas import Reading
from app.storage.database import Database
from app.storage.floor_plan import FloorPlanStore


def image_bytes(size=(800, 400), format="PNG", exif=None):
    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, format=format, **({"exif": exif} if exif else {}))
    return out.getvalue()


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, mock=True, token="map-test", origin="http://testserver")
    with TestClient(app) as client:
        client.get("/bootstrap?key=map-test", follow_redirects=False)
        client.headers["x-thermonest"] = "1"
        yield client


def upload(client, revision=""):
    return client.put(
        "/api/floor-plan/image",
        params={"expected_revision": revision},
        content=image_bytes(),
        headers={"content-type": "image/png"},
    )


def test_image_calibration_positions_replacement_and_history(client):
    assert client.get("/api/floor-plan").json() is None
    plan = upload(client).json()
    assert (plan["width"], plan["height"]) == (800, 400)
    assert plan["positions"] == []
    assert client.get("/api/floor-plan/image", params={"revision": plan["revision"]}).content.startswith(b"\x89PNG")
    assert upload(client).status_code == 409  # No accidental overwrites.
    data = {"revision": plan["revision"], "a": {"x": 0.1, "y": 0.2}, "b": {"x": 0.6, "y": 0.2}, "distance_m": 5}
    calibrated = client.put("/api/floor-plan/calibration", json=data).json()
    assert calibrated["calibration"]["meters_per_pixel"] == 0.0125
    assert client.put("/api/floor-plan/calibration", json={**data, "b": data["a"]}).status_code == 422
    assert client.put("/api/floor-plan/calibration", json={**data, "distance_m": 0}).status_code == 422
    assert client.put("/api/floor-plan/calibration", json={**data, "a": {"x": -1, "y": 0}}).status_code == 422
    db = client.app.state.db
    sensor = db.add_sensor({"display_name": "Map sensor", "room_id": None, "device_identifier": "demo-0"}, mock=True)
    sid = sensor["id"]
    db.add_reading(sid, Reading(temperature_c=23))
    position = {"revision": plan["revision"], "x": 0.25, "y": 0.75}
    assert client.put("/api/floor-plan/positions/nonexistent", json=position).status_code == 404
    assert client.put(f"/api/floor-plan/positions/{sid}", json={**position, "x": 1.1}).status_code == 422
    assert client.put(f"/api/floor-plan/positions/{sid}", json=position).json()["positions"][0]["x"] == 0.25
    assert (
        client.put(f"/api/floor-plan/positions/{sid}", json={**position, "x": 0.5}).json()["positions"][0]["x"] == 0.5
    )
    replaced = upload(client, plan["revision"]).json()
    assert replaced["positions"] == [] and replaced["calibration"] is None
    assert replaced["revision"] != plan["revision"]
    assert db.sensor(sid) is not None and db.rows("SELECT * FROM readings WHERE sensor_id=:sid", sid=sid)
    assert client.put(f"/api/floor-plan/positions/{sid}", json=position).status_code == 409
    assert client.put("/api/floor-plan/calibration", json=data).status_code == 409
    assert client.get("/api/floor-plan/image", params={"revision": plan["revision"]}).status_code == 404
    position["revision"] = replaced["revision"]
    client.put(f"/api/floor-plan/positions/{sid}", json=position)
    assert (
        client.delete(f"/api/floor-plan/positions/{sid}", params={"revision": replaced["revision"]}).json()["positions"]
        == []
    )
    assert db.sensor(sid) is not None
    client.put(f"/api/floor-plan/positions/{sid}", json=position)
    client.delete(f"/api/sensors/{sid}")
    assert client.get("/api/floor-plan").json()["positions"] == []


@pytest.mark.parametrize(
    "content,mime,code",
    [
        (b"<svg/>", "image/svg+xml", 415),
        (b"not an image", "image/png", 422),
        (image_bytes((10, 10)), "image/png", 422),
        (b"x" * (12 * 1024 * 1024 + 1), "image/png", 413),
    ],
)
def test_upload_validation(client, content, mime, code):
    assert client.put("/api/floor-plan/image", content=content, headers={"content-type": mime}).status_code == code
    assert client.get("/api/floor-plan").json() is None


def test_normalize_orientation_and_resizing():
    from app.api.floor_plan import normalize_image

    exif = Image.Exif()
    exif[274] = 6
    png, width, height = normalize_image(image_bytes((800, 400), "JPEG", exif))
    assert (width, height) == (400, 800)
    with Image.open(io.BytesIO(png)) as result:
        assert not result.getexif()
    _, width, height = normalize_image(image_bytes((5000, 1000)))
    assert (width, height) == (4096, 819)
    with pytest.raises(ValueError):
        normalize_image(image_bytes((5000, 5000)))


def test_migration_and_persisted_map(tmp_path):
    path = tmp_path / "test.sqlite3"
    db = Database(path)
    sensor = db.add_sensor({"display_name": "Existing", "room_id": None, "device_identifier": "old-id"})
    db.add_reading(sensor["id"], Reading(temperature_c=21))
    # Exercise upgrading the previous schema without losing existing readings.
    db.execute("DROP TABLE sensor_positions")
    db.execute("DROP TABLE floor_plan")
    db.execute("DELETE FROM migrations WHERE version=2")
    db.engine.dispose()
    db = Database(path)
    assert db.sensor(sensor["id"])["temperature_c"] == 21
    store = FloorPlanStore(db)
    plan = store.replace(image_bytes(), 800, 400, "")
    store.calibrate(
        plan["revision"], {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "distance_m": 10, "meters_per_pixel": 0.0125}
    )
    store.place(plan["revision"], sensor["id"], 0.4, 0.6)
    db.engine.dispose()
    reopened = Database(path)
    saved = FloorPlanStore(reopened).get()
    assert saved["revision"] == plan["revision"]
    assert saved["positions"] == [{"sensor_id": sensor["id"], "x": 0.4, "y": 0.6}]
    assert saved["calibration"]["distance_m"] == 10
    reopened.engine.dispose()
