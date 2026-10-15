import io
import math

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

from app.storage.floor_plan import FloorPlanStore, PlanChanged

MAX_UPLOAD = 12 * 1024 * 1024
MAX_PIXELS = 24_000_000


class Point(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class Calibration(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    revision: str = Field(min_length=1, max_length=64)
    a: Point
    b: Point
    distance_m: float = Field(gt=0, le=10000)


class Position(Point):
    revision: str = Field(min_length=1, max_length=64)


def normalize_image(data):
    try:
        with Image.open(io.BytesIO(data), formats=["PNG", "JPEG", "WEBP"]) as source:
            width, height = source.size
            if width * height > MAX_PIXELS or min(width, height) < 32 or max(width, height) > 16000:
                raise ValueError("Choose an image between 32 pixels and 24 megapixels (maximum side 16000 pixels).")
            if getattr(source, "is_animated", False):
                raise ValueError("Use a still image for your floor plan.")
            source.load()
            normalized = ImageOps.exif_transpose(source).convert("RGBA")
            normalized.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
            # New pixel image strips metadata and normalizes orientation before calibration.
            clean = Image.new("RGBA", normalized.size)
            clean.paste(normalized)
            out = io.BytesIO()
            clean.save(out, format="PNG")
            return out.getvalue(), *clean.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Choose a valid PNG, JPEG, or WebP image.") from exc


def router(db, manager):
    routes = APIRouter(prefix="/api/floor-plan", tags=["Floor plan"])
    store = FloorPlanStore(db)

    async def change(method, *args):
        try:
            result = await manager.call(method, *args)
        except PlanChanged as exc:
            raise HTTPException(409, str(exc)) from None
        await manager.publish({"type": "floor-plan"})
        return result

    @routes.get("")
    async def get_plan():
        return await manager.call(store.get)

    @routes.get("/image")
    async def image(revision: str):
        png = await manager.call(store.image, revision)
        if png is None:
            raise HTTPException(404, "Floor-plan image not found")
        return Response(png, media_type="image/png")

    @routes.put("/image")
    async def upload(request: Request, expected_revision: str = ""):
        if request.headers.get("content-type", "").split(";")[0] not in ("image/png", "image/jpeg", "image/webp"):
            raise HTTPException(415, "Use PNG, JPEG, or WebP.")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_UPLOAD:
                raise HTTPException(413, "Choose an image smaller than 12 MB.")
            data.extend(chunk)
        try:
            png, width, height = await manager.call(normalize_image, bytes(data))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        return await change(store.replace, png, width, height, expected_revision)

    @routes.put("/calibration")
    async def calibrate(data: Calibration):
        plan = await manager.call(store.get)
        if not plan or plan["revision"] != data.revision:
            raise HTTPException(409, "Reload the floor plan before calibrating.")
        pixels = math.hypot((data.b.x - data.a.x) * plan["width"], (data.b.y - data.a.y) * plan["height"])
        if pixels < 5:
            raise HTTPException(422, "Choose reference points at least 5 image pixels apart.")
        value = {
            "a": data.a.model_dump(),
            "b": data.b.model_dump(),
            "distance_m": data.distance_m,
            "meters_per_pixel": data.distance_m / pixels,
        }
        return await change(store.calibrate, data.revision, value)

    @routes.put("/positions/{sensor_id}")
    async def place(sensor_id: str, data: Position):
        if not await manager.call(db.sensor, sensor_id):
            raise HTTPException(404, "Sensor not found")
        return await change(store.place, data.revision, sensor_id, data.x, data.y)

    @routes.delete("/positions/{sensor_id}")
    async def unplace(sensor_id: str, revision: str):
        return await change(store.unplace, revision, sensor_id)

    return routes
