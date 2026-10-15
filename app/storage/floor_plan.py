"""Floor-plan image and geometry live in the same workspace database as sensors."""

import json
from uuid import uuid4

from sqlalchemy import text

from app.storage.database import now


class PlanChanged(ValueError):
    pass


class FloorPlanStore:
    def __init__(self, db):
        self.db = db

    def get(self):
        with self.db.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT revision,width,height,calibration FROM floor_plan WHERE id=1"))
                .mappings()
                .first()
            )
            if not row:
                return None
            return {
                **dict(row),
                "calibration": json.loads(row["calibration"]) if row["calibration"] else None,
                "positions": [dict(p) for p in connection.execute(text("SELECT * FROM sensor_positions")).mappings()],
            }

    def image(self, revision):
        rows = self.db.rows("SELECT image FROM floor_plan WHERE id=1 AND revision=:revision", revision=revision)
        return rows[0]["image"] if rows else None

    def replace(self, png, width, height, expected_revision):
        values = {"image": png, "width": width, "height": height, "revision": str(uuid4()), "created_at": now()}
        with self.db.engine.begin() as connection:
            if expected_revision:
                result = connection.execute(
                    text("""UPDATE floor_plan SET image=:image,width=:width,height=:height,
                    revision=:revision,created_at=:created_at,calibration=NULL WHERE id=1 AND revision=:expected"""),
                    {**values, "expected": expected_revision},
                )
            else:
                result = connection.execute(
                    text("""INSERT OR IGNORE INTO floor_plan
                    (id,revision,image,width,height,created_at) VALUES (1,:revision,:image,:width,:height,:created_at)"""),
                    values,
                )
            if result.rowcount != 1:
                raise PlanChanged("The floor plan changed. Reload it before trying again.")
            connection.execute(text("DELETE FROM sensor_positions"))
        return self.get()

    def calibrate(self, revision, calibration):
        count = self.db.execute(
            "UPDATE floor_plan SET calibration=:value WHERE id=1 AND revision=:revision",
            revision=revision,
            value=json.dumps(calibration),
        )
        if not count:
            raise PlanChanged("The floor plan changed. Reload it before calibrating.")
        return self.get()

    def place(self, revision, sensor_id, x, y):
        count = self.db.execute(
            """INSERT INTO sensor_positions(sensor_id,x,y)
            SELECT :sensor_id,:x,:y FROM floor_plan WHERE id=1 AND revision=:revision
            ON CONFLICT(sensor_id) DO UPDATE SET x=:x,y=:y""",
            revision=revision,
            sensor_id=sensor_id,
            x=x,
            y=y,
        )
        if not count:
            raise PlanChanged("The floor plan changed. Reload it before placing sensors.")
        return self.get()

    def unplace(self, revision, sensor_id):
        self.db.execute(
            """DELETE FROM sensor_positions WHERE sensor_id=:sensor_id
            AND EXISTS (SELECT 1 FROM floor_plan WHERE revision=:revision)""",
            revision=revision,
            sensor_id=sensor_id,
        )
        return self.get()
