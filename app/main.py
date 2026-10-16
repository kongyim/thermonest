import asyncio
import csv
import hmac
import io
import math
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from app.api.floor_plan import router as floor_plan_router
from app.ble.providers.mock import MockSensorProvider
from app.ble.providers.stock import StockSensorProvider
from app.models.schemas import BindKeyInput, RoomInput, SensorCreate, SensorPatch, SettingsPatch
from app.services.manager import SensorManager
from app.storage.database import Database


def create_app(data_dir: Path, *, mock=False, token=None, origin="http://127.0.0.1:8765", frontend_dir=None):
    db = Database(data_dir / ("demo.sqlite3" if mock else "thermonest.sqlite3"))
    manager = SensorManager(db, MockSensorProvider() if mock else StockSensorProvider())
    session_token = secrets.token_urlsafe(32)
    bootstrap_token = token or secrets.token_urlsafe(32)
    bootstrapped = False

    @asynccontextmanager
    async def lifespan(app):
        await manager.start()
        yield
        await manager.stop()
        db.engine.dispose()

    app = FastAPI(
        title="ThermoNest local API",
        version="0.2.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.include_router(floor_plan_router(db, manager))
    app.state.db, app.state.manager = db, manager
    app.state.bootstrap_token = bootstrap_token

    @app.middleware("http")
    async def secure_local(request: Request, call_next):
        if request.headers.get("host") != origin.split("://", 1)[1]:
            return JSONResponse({"detail": "Invalid host"}, 403)
        request_origin = request.headers.get("origin")
        if request_origin and request_origin != origin:
            return JSONResponse({"detail": "Invalid origin"}, 403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-site request refused"}, 403)
        if request.url.path != "/bootstrap":
            authenticated = hmac.compare_digest(request.cookies.get("thermonest_session", ""), session_token)
            if not authenticated:
                return JSONResponse({"detail": "Open ThermoNest from the desktop launcher"}, 401)
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-thermonest") != "1":
            return JSONResponse({"detail": "Missing local request header"}, 403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' "
            + origin.replace("http:", "ws:")
            + "; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        return response

    @app.get("/bootstrap")
    async def bootstrap(key: str = ""):
        nonlocal bootstrapped
        if bootstrapped or not hmac.compare_digest(key, bootstrap_token):
            raise HTTPException(403, "Invalid launch session")
        bootstrapped = True
        response = RedirectResponse("/", status_code=303)
        response.set_cookie("thermonest_session", session_token, httponly=True, samesite="strict", path="/")
        return response

    @app.exception_handler(IntegrityError)
    async def conflict(request, exc):
        return JSONResponse({"detail": "Sensor already registered, or room does not exist."}, 409)

    async def require_sensor(sid):
        sensor = await manager.call(db.sensor, sid)
        if not sensor:
            raise HTTPException(404, "Sensor not found")
        return sensor

    @app.get("/api/health")
    async def health():
        return {"ok": True, "mock": mock, "bluetooth": manager.adapter_status}

    @app.get("/api/sensors")
    async def sensors():
        return await manager.call(db.sensors)

    @app.post("/api/sensors/discover")
    async def discover():
        try:
            return await manager.discover()
        except Exception:
            raise HTTPException(503, manager.adapter_status + ": check Bluetooth and macOS permissions") from None

    @app.post("/api/sensors", status_code=201)
    async def register(data: SensorCreate):
        if data.device_identifier not in manager.candidates:
            raise HTTPException(422, "Scan and select a discovered candidate first")
        sensor = await manager.call(db.add_sensor, data.model_dump(), mock)
        await manager.call(db.update_sensor, sensor["id"], {"rssi": manager.candidates[data.device_identifier]["rssi"]})
        return sensor

    @app.patch("/api/sensors/{sid}")
    async def update_sensor(sid: str, data: SensorPatch):
        await require_sensor(sid)
        values = data.model_dump(exclude_unset=True)
        if any(values.get(k, "valid") is None for k in ("display_name", "device_identifier")):
            raise HTTPException(422, "Name and identifier cannot be null")
        if "device_identifier" in values:
            if values["device_identifier"] not in manager.candidates:
                raise HTTPException(422, "Rediscover the device first")
            await manager.remove(sid)
        await manager.call(db.update_sensor, sid, values)
        return await require_sensor(sid)

    @app.delete("/api/sensors/{sid}", status_code=204)
    async def delete_sensor(sid: str):
        await require_sensor(sid)
        await manager.remove(sid)
        if not mock:
            await manager.call(manager.keys.delete, sid)
        await manager.call(db.execute, "DELETE FROM sensors WHERE id=:id", id=sid)
        return Response(status_code=204)

    @app.put("/api/sensors/{sid}/bind-key", status_code=204)
    async def bind_key(sid: str, data: BindKeyInput):
        await require_sensor(sid)
        if mock:
            raise HTTPException(400, "Demo sensors do not use bind keys")
        try:
            await manager.call(manager.keys.put, sid, data.key)
        except Exception:
            raise HTTPException(503, "macOS Keychain is unavailable or access was denied") from None
        return Response(status_code=204)

    def bounds(start, end):
        end = end or datetime.now(timezone.utc)
        start = start or end - timedelta(hours=24)
        if not start.tzinfo or not end.tzinfo:
            raise HTTPException(422, "Dates must include a timezone")
        if start >= end or end - start > timedelta(days=366):
            raise HTTPException(422, "Choose a positive range of at most 366 days")
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)

    @app.get("/api/sensors/{sid}/readings")
    async def readings(sid: str, start: datetime | None = None, end: datetime | None = None):
        await require_sensor(sid)
        start, end = bounds(start, end)
        bucket = max(60, math.ceil((end - start).total_seconds() / 800))
        return await manager.call(db.history, sid, start.isoformat(), end.isoformat(), bucket)

    @app.get("/api/sensors/{sid}/export")
    async def export(sid: str, start: datetime | None = None, end: datetime | None = None):
        await require_sensor(sid)
        start, end = bounds(start, end)
        rows = await manager.call(db.history, sid, start.isoformat(), end.isoformat())
        stream = io.StringIO()
        writer = csv.DictWriter(
            stream, fieldnames=["timestamp", "temperature_c", "humidity_percent", "battery_level", "voltage_mv"]
        )
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            stream.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="thermonest-readings.csv"'},
        )

    @app.get("/api/rooms")
    async def rooms():
        return await manager.call(db.rooms)

    @app.post("/api/rooms", status_code=201)
    async def add_room(data: RoomInput):
        return await manager.call(db.add_room, **data.model_dump())

    @app.patch("/api/rooms/{rid}")
    async def edit_room(rid: str, data: RoomInput):
        count = await manager.call(
            db.execute, "UPDATE rooms SET name=:name,sort_order=:sort_order WHERE id=:id", id=rid, **data.model_dump()
        )
        if not count:
            raise HTTPException(404, "Room not found")
        return {"id": rid, **data.model_dump()}

    @app.get("/api/settings")
    async def settings():
        return {**await manager.call(db.settings), "mock": mock}

    @app.patch("/api/settings")
    async def set_settings(data: SettingsPatch):
        values = data.model_dump(exclude_none=True)
        if values.get("battery_mode") == "balanced":
            values["sampling_seconds"] = 300
        elif "sampling_seconds" in values and "battery_mode" not in values:
            values["battery_mode"] = "custom"
        await manager.call(db.set_settings, values)
        return await settings()

    @app.get("/api/dashboard/summary")
    async def summary():
        items = await sensors()
        fresh = [
            s
            for s in items
            if s["last_seen"]
            and (datetime.now(timezone.utc) - datetime.fromisoformat(s["last_seen"])).total_seconds()
            < max(180, (await settings())["sampling_seconds"] * 3)
        ]
        temperatures = [s["temperature_c"] for s in fresh if s["temperature_c"] is not None]
        humidity = [s["humidity_percent"] for s in fresh if s["humidity_percent"] is not None]
        return {
            "total": len(items),
            "online": len(fresh),
            "offline": len(items) - len(fresh),
            "temperature_c": sum(temperatures) / len(temperatures) if temperatures else None,
            "humidity_percent": sum(humidity) / len(humidity) if humidity else None,
            "last_updated": max((s["last_seen"] for s in items if s["last_seen"]), default=None),
        }

    @app.get("/api/openapi.json")
    async def schema():
        return app.openapi()

    @app.websocket("/ws/readings")
    async def websocket(ws: WebSocket):
        if (
            ws.headers.get("host") != origin.split("://", 1)[1]
            or ws.headers.get("origin") != origin
            or not hmac.compare_digest(ws.cookies.get("thermonest_session", ""), session_token)
        ):
            await ws.close(code=1008)
            return
        await ws.accept()
        queue = asyncio.Queue(maxsize=50)
        manager.listeners.add(queue)

        async def receive_until_closed():
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    return

        receiver = asyncio.create_task(receive_until_closed())
        pending_event = None
        try:
            while not receiver.done():
                pending_event = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait([pending_event, receiver], timeout=20, return_when=asyncio.FIRST_COMPLETED)
                if receiver in done:
                    break
                if pending_event in done:
                    event = pending_event.result()
                else:
                    pending_event.cancel()
                    await asyncio.gather(pending_event, return_exceptions=True)
                    event = {"type": "heartbeat"}
                await ws.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            receiver.cancel()
            if pending_event:
                pending_event.cancel()
            await asyncio.gather(receiver, *([pending_event] if pending_event else []), return_exceptions=True)
            manager.listeners.discard(queue)

    frontend = Path(frontend_dir) if frontend_dir else Path(__file__).parent.parent / "frontend" / "dist"
    if (frontend / "assets").exists():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

    @app.get("/")
    async def index():
        if not (frontend / "index.html").exists():
            raise HTTPException(503, "Build the frontend with npm run build first")
        return FileResponse(frontend / "index.html")

    return app
