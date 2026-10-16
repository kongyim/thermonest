"""Small versioned SQLite store. Every operation owns its connection (safe in worker threads)."""

import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import create_engine, event, text


def now():
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

        @event.listens_for(self.engine, "connect")
        def configure(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA busy_timeout=5000")

        with self.engine.begin() as c:
            c.exec_driver_sql("PRAGMA journal_mode=WAL")
            c.exec_driver_sql("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)")
            version = c.exec_driver_sql("SELECT COALESCE(MAX(version),0) FROM migrations").scalar()
            if version < 1:
                for sql in [
                    "CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)",
                    """CREATE TABLE sensors (id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
                    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL, device_identifier TEXT UNIQUE NOT NULL,
                    model TEXT NOT NULL DEFAULT 'LYWSD03MMC', firmware_type TEXT NOT NULL DEFAULT 'stock',
                    last_seen TEXT, battery_level INTEGER, status TEXT NOT NULL DEFAULT 'Disconnected',
                    rssi INTEGER, error TEXT, created_at TEXT NOT NULL)""",
                    """CREATE TABLE readings (id INTEGER PRIMARY KEY, sensor_id TEXT NOT NULL REFERENCES sensors(id)
                    ON DELETE CASCADE, timestamp TEXT NOT NULL, temperature_c REAL, humidity_percent REAL,
                    battery_level INTEGER, voltage_mv INTEGER)""",
                    "CREATE INDEX ix_readings_sensor_time ON readings(sensor_id, timestamp)",
                    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
                    "INSERT INTO migrations VALUES (1)",
                ]:
                    c.exec_driver_sql(sql)
            if version < 2:
                c.exec_driver_sql("""CREATE TABLE floor_plan (
                    id INTEGER PRIMARY KEY CHECK (id=1), revision TEXT NOT NULL,
                    image BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
                    calibration TEXT, created_at TEXT NOT NULL)""")
                c.exec_driver_sql("""CREATE TABLE sensor_positions (
                    sensor_id TEXT PRIMARY KEY REFERENCES sensors(id) ON DELETE CASCADE,
                    x REAL NOT NULL CHECK (x>=0 AND x<=1), y REAL NOT NULL CHECK (y>=0 AND y<=1))""")
                c.exec_driver_sql("INSERT INTO migrations VALUES (2)")
        # A process restart cannot preserve a live connection.
        with self.engine.begin() as c:
            c.exec_driver_sql("UPDATE sensors SET status='Disconnected', error=NULL")

    def rows(self, sql, **params):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings()]

    def execute(self, sql, **params):
        with self.engine.begin() as c:
            return c.execute(text(sql), params).rowcount

    def sensors(self):
        return self.rows("""SELECT s.*, r.name AS room_name,
            (SELECT temperature_c FROM readings WHERE sensor_id=s.id AND temperature_c IS NOT NULL ORDER BY timestamp DESC LIMIT 1) AS temperature_c,
            (SELECT humidity_percent FROM readings WHERE sensor_id=s.id AND humidity_percent IS NOT NULL ORDER BY timestamp DESC LIMIT 1) AS humidity_percent
            FROM sensors s LEFT JOIN rooms r ON s.room_id=r.id ORDER BY r.sort_order, s.created_at""")

    def sensor(self, sensor_id):
        return next((s for s in self.sensors() if s["id"] == sensor_id), None)

    def add_sensor(self, data, mock=False):
        sensor_id = str(uuid4())
        self.execute(
            """INSERT INTO sensors (id,display_name,room_id,device_identifier,created_at,firmware_type)
            VALUES (:id,:display_name,:room_id,:device_identifier,:created_at,:firmware)""",
            id=sensor_id,
            **data,
            created_at=now(),
            firmware="mock" if mock else "stock",
        )
        return self.sensor(sensor_id)

    def update_sensor(self, sensor_id, values):
        allowed = {
            "display_name",
            "room_id",
            "device_identifier",
            "status",
            "last_seen",
            "battery_level",
            "rssi",
            "error",
        }
        values = {k: v for k, v in values.items() if k in allowed}
        if values:
            self.execute(
                "UPDATE sensors SET " + ",".join(f"{k}=:{k}" for k in values) + " WHERE id=:id", id=sensor_id, **values
            )

    def add_reading(self, sensor_id, reading, timestamp=None):
        stamp = timestamp or now()
        with self.engine.begin() as c:
            c.execute(
                text("""INSERT INTO readings(sensor_id,timestamp,temperature_c,humidity_percent,battery_level,voltage_mv)
                VALUES (:id,:timestamp,:temperature_c,:humidity_percent,:battery_level,:voltage_mv)"""),
                {"id": sensor_id, "timestamp": stamp, **reading.model_dump()},
            )
            c.execute(
                text(
                    "UPDATE sensors SET last_seen=:stamp, battery_level=COALESCE(:battery,battery_level), status='Receiving', error=NULL WHERE id=:id"
                ),
                {"stamp": stamp, "battery": reading.battery_level, "id": sensor_id},
            )

    def rooms(self):
        return self.rows("SELECT * FROM rooms ORDER BY sort_order,name")

    def add_room(self, name, sort_order=0):
        room = {"id": str(uuid4()), "name": name, "sort_order": sort_order}
        self.execute("INSERT INTO rooms VALUES (:id,:name,:sort_order)", **room)
        return room

    def settings(self):
        settings = {
            "sampling_seconds": 300,
            "battery_mode": "balanced",
            "theme": "system",
            **{r["key"]: json.loads(r["value"]) for r in self.rows("SELECT * FROM settings")},
        }

        if settings["battery_mode"] == "balanced":
            settings["sampling_seconds"] = 300
        return settings

    def set_settings(self, values):
        with self.engine.begin() as c:
            for key, value in values.items():
                c.execute(
                    text("INSERT INTO settings VALUES (:key,:value) ON CONFLICT(key) DO UPDATE SET value=:value"),
                    {"key": key, "value": json.dumps(value)},
                )

    def history(self, sensor_id, start, end, bucket_seconds=None):
        if bucket_seconds:
            return self.rows(
                """SELECT MIN(timestamp) AS timestamp, AVG(temperature_c) AS temperature_c,
                AVG(humidity_percent) AS humidity_percent, MAX(battery_level) AS battery_level
                FROM readings WHERE sensor_id=:id AND timestamp>=:start AND timestamp<=:end
                GROUP BY CAST(strftime('%s',timestamp) AS INTEGER)/:bucket ORDER BY timestamp""",
                id=sensor_id,
                start=start,
                end=end,
                bucket=bucket_seconds,
            )
        return self.rows(
            """SELECT timestamp,temperature_c,humidity_percent,battery_level,voltage_mv FROM readings
            WHERE sensor_id=:id AND timestamp>=:start AND timestamp<=:end ORDER BY timestamp""",
            id=sensor_id,
            start=start,
            end=end,
        )
