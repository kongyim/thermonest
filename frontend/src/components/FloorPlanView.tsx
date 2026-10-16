import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ImagePlus,
  Ruler,
  MapPin,
  Minus,
  Plus,
  LocateFixed,
  Layers,
  X,
  Upload,
  Thermometer,
} from "lucide-react";
import { api, ago, isFresh, number, type Sensor } from "../api";
import {
  clampPoint,
  distanceMeters,
  distancePixels,
  estimateTemperature,
  temperatureColor,
  type FloorPlan,
  type Point,
  type TemperaturePoint,
} from "../floor-plan";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import "./floor-plan.scss";

// Display preferences belong to this browser, independently of sensor polling.
function useMapPreference<T>(key: string, fallback: T, valid: (value: unknown) => boolean) {
  const storageKey = `thermonest.floor-plan.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return valid(saved) ? saved as T : fallback;
    } catch {
      return fallback;
    }
  });
  function save(next: T) {
    setValue(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The controls still work when browser storage is unavailable.
    }
  }
  return [value, save] as const;
}

type Mode = "view" | "calibrate" | "measure" | "place";
export default function FloorPlanView({
  sensors,
  sampling,
  notify,
}: {
  sensors: Sensor[];
  sampling: number;
  notify: (s: string) => void;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["floor-plan"],
    queryFn: () => api<FloorPlan | null>("/floor-plan"),
  });
  const plan = query.data;
  const input = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [points, setPoints] = useState<Point[]>([]);
  const [knownLength, setKnownLength] = useState("");
  const [unit, setUnit] = useMapPreference<"m" | "ft">("unit", "m", (v) => v === "m" || v === "ft");
  const [selected, setSelected] = useState("");
  const [zoom, setZoom] = useState(1);
  const [heat, setHeat] = useMapPreference("heat", true, (v) => typeof v === "boolean");
  const [opacity, setOpacity] = useMapPreference("opacity", 0.48,
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 0.8);
  const [radius, setRadius] = useMapPreference("radius", 5,
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [drag, setDrag] = useState<{ sensor_id: string; point: Point } | null>(
    null,
  );
  const dragRef = useRef<{
    sensor_id: string;
    point: Point;
    moved: boolean;
    clientX: number;
    clientY: number;
  } | null>(null);
  // Refresh time-dependent freshness even when the radio is quiet.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setMode("view");
    setPoints([]);
    setZoom(1);
    setSelected("");
    setDrag(null);
    dragRef.current = null;
  }, [plan?.revision]);
  const placements =
    plan?.positions.map((p) =>
      drag?.sensor_id === p.sensor_id ? { ...p, ...drag.point } : p,
    ) ?? [];
  const freshSamples: TemperaturePoint[] = placements.flatMap((p) => {
    const sensor = sensors.find((s) => s.id === p.sensor_id);
    return sensor && isFresh(sensor, sampling) && sensor.temperature_c !== null
      ? [{ x: p.x, y: p.y, temperature: sensor.temperature_c }]
      : [];
  });
  const sampleKey = JSON.stringify(freshSamples);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !plan) return;
    const ratio = Math.min(1, 520 / plan.width, 520 / plan.height);
    target.width = Math.max(1, Math.round(plan.width * ratio));
    target.height = Math.max(1, Math.round(plan.height * ratio));
    const context = target.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, target.width, target.height);
    if (!heat || !plan.calibration) return;
    const samples = JSON.parse(sampleKey) as TemperaturePoint[];
    const pixels = context.createImageData(target.width, target.height);
    for (let y = 0; y < target.height; y++)
      for (let x = 0; x < target.width; x++) {
        const estimate = estimateTemperature(
          { x: (x + 0.5) / target.width, y: (y + 0.5) / target.height },
          samples,
          plan,
          radius,
        );
        if (!estimate) continue;
        const offset = (y * target.width + x) * 4;
        pixels.data.set(temperatureColor(estimate.temperature), offset);
        pixels.data[offset + 3] = Math.round(255 * estimate.confidence);
      }
    context.putImageData(pixels, 0, 0);
  }, [
    plan?.revision,
    plan?.calibration?.meters_per_pixel,
    sampleKey,
    heat,
    radius,
    clock,
  ]);
  async function mutate(fn: () => Promise<FloorPlan | null>, success?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      qc.setQueryData(["floor-plan"], result);
      if (success) notify(success);
      return true;
    } catch (e) {
      setError((e as Error).message);
      qc.invalidateQueries({ queryKey: ["floor-plan"] });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size > 12 * 1024 * 1024) {
      setError("Choose an image smaller than 12 MB.");
      return;
    }
    const saved = await mutate(async () => {
      const response = await fetch(
        `/api/floor-plan/image?expected_revision=${encodeURIComponent(plan?.revision ?? "")}`,
        {
          method: "PUT",
          headers: {
            "X-ThermoNest": "1",
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : "Could not upload this image.",
        );
      }
      return response.json();
    }, "Floor plan saved on this Mac. Set its scale to get started.");
    if (saved) setPendingImage(null);
  }
  function chooseMode(value: Mode) {
    setMode(value);
    setPoints([]);
    setError("");
  }
  function pointFromEvent(event: { clientX: number; clientY: number }): Point {
    const rect = surface.current!.getBoundingClientRect();
    return clampPoint({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }
  async function place(sensorId: string, point: Point) {
    if (!plan) return;
    const saved = await mutate(() =>
      api<FloorPlan>(`/floor-plan/positions/${sensorId}`, "PUT", {
        revision: plan.revision,
        ...point,
      }),
    );
    if (saved) {
      setSelected(sensorId);
      setMode("view");
    }
  }
  function mapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (busy || !plan || dragRef.current) return;
    const p = pointFromEvent(event);
    if (mode === "calibrate" || mode === "measure")
      setPoints((old) => (old.length >= 2 ? [p] : [...old, p]));
    else if (mode === "place" && selected) void place(selected, p);
  }
  function startDrag(
    event: PointerEvent<HTMLButtonElement>,
    sensor_id: string,
  ) {
    if (
      busy ||
      mode === "calibrate" ||
      mode === "measure" ||
      event.button !== 0
    )
      return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(sensor_id);
    const position = placements.find((p) => p.sensor_id === sensor_id)!;
    dragRef.current = {
      sensor_id,
      point: position,
      moved: false,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    const moved =
      current.moved ||
      Math.hypot(
        event.clientX - current.clientX,
        event.clientY - current.clientY,
      ) > 3;
    current.moved = moved;
    if (moved) {
      current.point = pointFromEvent(event);
      setDrag({ sensor_id: current.sensor_id, point: current.point });
    }
  }
  async function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    event.stopPropagation();
    dragRef.current = null;
    if (current.moved) await place(current.sensor_id, current.point);
    setDrag(null);
  }
  async function calibrate() {
    if (!plan || points.length !== 2) return;
    const distance_m = Number(knownLength) * (unit === "ft" ? 0.3048 : 1);
    if (!Number.isFinite(distance_m) || distance_m <= 0) {
      setError("Enter a positive reference distance.");
      return;
    }
    const saved = await mutate(
      () =>
        api<FloorPlan>("/floor-plan/calibration", "PUT", {
          revision: plan.revision,
          a: points[0],
          b: points[1],
          distance_m,
        }),
      "Scale saved. Sensor positions stay in place.",
    );
    if (saved) {
      setMode("view");
      setPoints([]);
    }
  }
  const selectedSensor = sensors.find((s) => s.id === selected);
  const selectedPosition = placements.find((p) => p.sensor_id === selected);
  const line =
    points.length
      ? points
      : mode === "calibrate" && plan?.calibration
        ? [plan.calibration.a, plan.calibration.b]
        : [];
  const measured =
    points.length === 2 && plan
      ? distanceMeters(points[0], points[1], plan)
      : null;
  const displayDistance = (meters: number) =>
    `${number(unit === "ft" ? meters / 0.3048 : meters, 2)} ${unit}`;
  const mapWidth = plan?.calibration
    ? plan.width * plan.calibration.meters_per_pixel
    : null;
  const mapHeight = plan?.calibration
    ? plan.height * plan.calibration.meters_per_pixel
    : null;
  const scaleMeters = mapWidth
    ? Math.pow(10, Math.floor(Math.log10(mapWidth / 5)))
    : null;
  return (
    <section className="floor-plan-view">
      <input
        ref={input}
        aria-label="Upload floor-plan image"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          setError("");
          if (file) {
            if (plan) setPendingImage(file);
            else void upload(file);
          }
        }}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Dismiss map error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {query.error && (
        <div className="error-banner" role="alert">
          {query.error.message}
          <Button variant="outline" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {query.isLoading ? (
        <div className="empty-state">Loading your floor plan…</div>
      ) : !plan ? (
        <div className="empty-state floor-empty">
          <div className="floor-empty-art">
            <div />
            <div />
            <div />
            <MapPin size={28} />
          </div>
          <span className="eyebrow">A NEW PERSPECTIVE ON HOME</span>
          <h2>Put your home on the map.</h2>
          <p>
            Upload a floor plan, mark a known distance, and place your
            thermometers.
            <br />
            See the temperature of each space, right where it belongs.
          </p>
          <Button disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus size={17} />
            {busy ? "Preparing your image…" : "Upload floor plan"}
          </Button>
          <small>
            PNG, JPEG, or WebP · Up to 12 MB · Saved only on this Mac
          </small>
          <div className="floor-steps">
            <span>
              <span>1</span>Upload a plan
            </span>
            <span>
              <span>2</span>Set the scale
            </span>
            <span>
              <span>3</span>Place your sensors
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="map-toolbar">
            <div className="map-tools">
              <Button
                variant={mode === "calibrate" ? "default" : "outline"}
                disabled={busy}
                onClick={() => chooseMode("calibrate")}
              >
                <Ruler size={15} />
                {plan.calibration ? "Adjust scale" : "Set scale"}
              </Button>
              <Button
                variant={mode === "measure" ? "default" : "outline"}
                disabled={busy || !plan.calibration}
                onClick={() => chooseMode("measure")}
              >
                <Ruler size={15} />
                Measure
              </Button>
              <Button
                variant={mode === "place" ? "default" : "outline"}
                disabled={busy || !selected}
                onClick={() => chooseMode("place")}
              >
                <MapPin size={15} />
                Place sensor
              </Button>
              {mode !== "view" && (
                <Button variant="ghost" onClick={() => chooseMode("view")}>
                  Cancel
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={15} />
              Replace image
            </Button>
          </div>
          <div className="map-layout">
            <div className="map-main">
              <div className="map-instruction" role="status">
                {busy
                  ? "Saving your changes…"
                  : mode === "calibrate"
                    ? `Set scale: ${points.length === 0 ? "click the first end of a known length." : points.length === 1 ? "click the other end." : "enter the real distance below."}`
                    : mode === "measure"
                      ? points.length === 2
                        ? `Measured distance: ${displayDistance(measured ?? 0)}`
                        : "Measure: click two points on your plan."
                      : mode === "place"
                        ? `Click the plan to place ${selectedSensor?.display_name ?? "your sensor"}.`
                        : "Select a sensor to place it, or drag an existing pin to move it."}
              </div>
              {mode === "calibrate" && points.length === 2 && (
                <form
                  className="calibration-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void calibrate();
                  }}
                >
                  <label>
                    Known distance
                    <input
                      aria-label="Known distance"
                      type="number"
                      min="0.001"
                      max={unit === "m" ? 10000 : 32808}
                      step="any"
                      required
                      value={knownLength}
                      onChange={(e) => setKnownLength(e.target.value)}
                      placeholder="e.g. 4.5"
                    />
                  </label>
                  <select
                    aria-label="Calibration unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as "m" | "ft")}
                  >
                    <option value="m">Metres</option>
                    <option value="ft">Feet</option>
                  </select>
                  <Button
                    disabled={
                      busy ||
                      distancePixels(
                        points[0],
                        points[1],
                        plan.width,
                        plan.height,
                      ) < 5
                    }
                  >
                    Save scale
                  </Button>
                  <small>
                    Use a long, known wall or doorway for a more accurate scale.
                  </small>
                </form>
              )}
              <div className="map-viewport">
                <div
                  className={`map-surface mode-${mode}`}
                  ref={surface}
                  data-testid="map-surface"
                  style={{
                    width: `${zoom * 100}%`,
                    aspectRatio: `${plan.width} / ${plan.height}`,
                  }}
                  onClick={mapClick}
                >
                  <img
                    src={`/api/floor-plan/image?revision=${encodeURIComponent(plan.revision)}`}
                    alt="Your uploaded floor plan"
                    draggable={false}
                  />
                  <canvas
                    ref={canvas}
                    className="temperature-overlay"
                    data-testid="temperature-overlay"
                    style={{ opacity: heat ? opacity : 0 }}
                    aria-label="Estimated temperature overlay; sensor pins show actual measurements"
                  />
                  <svg
                    className="map-reference"
                    viewBox={`0 0 ${plan.width} ${plan.height}`}
                    aria-hidden="true"
                  >
                    {line.length === 2 && (
                      <line
                        x1={line[0].x * plan.width}
                        y1={line[0].y * plan.height}
                        x2={line[1].x * plan.width}
                        y2={line[1].y * plan.height}
                        stroke="#344bce"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        strokeDasharray="6 4"
                      />
                    )}
                    {(points.length
                      ? points
                      : mode === "calibrate" && plan.calibration
                        ? line
                        : []
                    ).map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x * plan.width}
                        cy={p.y * plan.height}
                        r={Math.max(plan.width, plan.height) / 150}
                        fill="#fff"
                        stroke="#344bce"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  {placements.map((position) => {
                    const sensor = sensors.find(
                      (s) => s.id === position.sensor_id,
                    );
                    if (!sensor) return null;
                    const fresh =
                      isFresh(sensor, sampling) &&
                      sensor.temperature_c !== null;
                    const color = fresh
                      ? `rgb(${temperatureColor(sensor.temperature_c!).join(",")})`
                      : "#8c9691";
                    return (
                      <button
                        key={sensor.id}
                        aria-label={`Move ${sensor.display_name}`}
                        title={`${sensor.display_name} · ${fresh ? number(sensor.temperature_c) + " °C" : "No current temperature"} · ${ago(sensor.last_seen)}`}
                        className={`map-pin ${selected === sensor.id ? "selected" : ""} ${fresh ? "" : "stale"}`}
                        style={
                          {
                            left: `${position.x * 100}%`,
                            top: `${position.y * 100}%`,
                            "--pin-color": color,
                          } as CSSProperties
                        }
                        disabled={busy}
                        onPointerDown={(e) => startDrag(e, sensor.id)}
                        onPointerMove={moveDrag}
                        onPointerUp={(e) => void endDrag(e)}
                        onPointerCancel={() => {
                          dragRef.current = null;
                          setDrag(null);
                        }}
                        onClick={(e) => {
                          if (mode === "calibrate" || mode === "measure")
                            return;
                          e.stopPropagation();
                          setSelected(sensor.id);
                        }}
                      >
                        <span className="pin-dot">
                          <Thermometer size={14} />
                        </span>
                        <span className="pin-label">
                          <strong>
                            {sensor.room_name ?? sensor.display_name}
                          </strong>
                          <span>
                            {fresh
                              ? `${number(sensor.temperature_c)}°C`
                              : "No current reading"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="map-view-controls">
                <div className="map-zoom">
                  <button
                    aria-label="Zoom out"
                    disabled={zoom <= 1}
                    onClick={() => setZoom(Math.max(1, zoom - 0.25))}
                  >
                    <Minus size={15} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    aria-label="Zoom in"
                    disabled={zoom >= 3}
                    onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    aria-label="Fit floor plan"
                    onClick={() => setZoom(1)}
                  >
                    <LocateFixed size={15} />
                  </button>
                </div>
                {mapWidth && mapHeight ? (
                  <span className="map-size">
                    Image extent: {displayDistance(mapWidth)} ×{" "}
                    {displayDistance(mapHeight)}
                  </span>
                ) : (
                  <span className="map-size">Scale not set</span>
                )}
              </div>
              {scaleMeters && mapWidth && (
                <div
                  className="map-scale"
                  style={{ width: `${(scaleMeters / mapWidth) * 100 * zoom}%` }}
                >
                  <span>{displayDistance(scaleMeters)}</span>
                </div>
              )}
              <div className="map-legend">
                <span>Temperature</span>
                <div>
                  <div className="temperature-gradient" />
                  <div className="legend-ticks">
                    <span>≤16°C</span>
                    <span>20°C</span>
                    <span>24°C</span>
                    <span>≥28°C</span>
                  </div>
                </div>
                <span className="map-legend-muted">
                  Grey pins: no fresh reading
                </span>
              </div>
            </div>
            <aside className="map-sidebar">
              <div className="map-panel-heading">
                <MapPin size={17} />
                <h3>Your thermometers</h3>
                <span>
                  {placements.length}/{sensors.length}
                </span>
              </div>
              <p className="map-panel-help">
                Select a thermometer, then click its location on the plan. Drag
                pins to fine-tune.
              </p>
              <div className="map-sensor-list">
                {sensors.map((sensor) => {
                  const placed = placements.some(
                    (p) => p.sensor_id === sensor.id,
                  );
                  return (
                    <button
                      key={sensor.id}
                      disabled={busy}
                      className={selected === sensor.id ? "active" : ""}
                      onClick={() => {
                        setSelected(sensor.id);
                        chooseMode("place");
                      }}
                    >
                      <span
                        className="map-sensor-dot"
                        style={{
                          background:
                            isFresh(sensor, sampling) &&
                            sensor.temperature_c !== null
                              ? `rgb(${temperatureColor(sensor.temperature_c).join(",")})`
                              : "#a0aaa5",
                        }}
                      />
                      <span>
                        <strong>{sensor.display_name}</strong>
                        <small>
                          {sensor.room_name ?? "Unassigned room"} ·{" "}
                          {placed ? "On map" : "Not placed"}
                        </small>
                      </span>
                      <span>
                        {isFresh(sensor, sampling) &&
                        sensor.temperature_c !== null
                          ? `${number(sensor.temperature_c)}°`
                          : "—"}
                      </span>
                    </button>
                  );
                })}
                {!sensors.length && (
                  <p className="hint">
                    Use Add sensor above to register a thermometer, then place
                    it here.
                  </p>
                )}
              </div>
              {selectedPosition && selectedSensor && (
                <div className="map-selected">
                  <strong>{selectedSensor.display_name}</strong>
                  <p>
                    {ago(selectedSensor.last_seen)} · {selectedSensor.status}
                  </p>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          api<FloorPlan>(
                            `/floor-plan/positions/${selected}?revision=${encodeURIComponent(plan.revision)}`,
                            "DELETE",
                          ),
                        "Sensor removed from the map. Its history is unchanged.",
                      )
                    }
                  >
                    <X size={13} />
                    Remove pin
                  </Button>
                </div>
              )}
              <div className="map-overlay-settings">
                <div className="map-panel-heading">
                  <Layers size={17} />
                  <h3>Temperature colour</h3>
                </div>
                <label className="map-toggle">
                  <span>Show estimated overlay</span>
                  <input
                    aria-label="Show estimated overlay"
                    type="checkbox"
                    checked={heat}
                    onChange={(e) => setHeat(e.target.checked)}
                  />
                </label>
                <label>
                  Opacity <span>{Math.round(opacity * 100)}%</span>
                  <input
                    aria-label="Overlay opacity"
                    type="range"
                    min="0"
                    max=".8"
                    step=".05"
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                  />
                </label>
                <label>
                  Sensor influence <span>{displayDistance(radius)}</span>
                  <input
                    aria-label="Sensor influence"
                    type="range"
                    min="1"
                    max="20"
                    step=".5"
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                  />
                </label>
                <label className="map-units">
                  Distance units
                  <select
                    aria-label="Map distance units"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as "m" | "ft")}
                  >
                    <option value="m">Metres</option>
                    <option value="ft">Feet</option>
                  </select>
                </label>
                <p className="map-overlay-note">
                  {!plan.calibration
                    ? "Set the scale to enable the overlay. "
                    : ""}
                  {freshSamples.length === 0
                    ? "Waiting for fresh temperatures from placed sensors. "
                    : ""}
                  Pins show measurements. Colour between them is an estimate
                  that fades beyond the influence distance. Walls and airflow
                  are not modelled.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
      <Dialog
        open={!!pendingImage}
        onOpenChange={(v) => {
          if (!v && !busy) setPendingImage(null);
        }}
        title="Replace your floor plan?"
        description="The new image will reset the scale and all pin positions. Your sensors, rooms, and reading history will stay saved."
      >
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setPendingImage(null)}
          >
            Keep current plan
          </Button>
          <Button
            disabled={busy}
            onClick={() => pendingImage && void upload(pendingImage)}
          >
            {busy ? "Uploading…" : "Replace floor plan"}
          </Button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </Dialog>
    </section>
  );
}
