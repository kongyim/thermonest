import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Battery,
  BedDouble,
  Bluetooth,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  DoorOpen,
  Droplets,
  Home,
  LayoutGrid,
  Map,
  Leaf,
  LoaderCircle,
  Monitor,
  Moon,
  Plus,
  Radio,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Signal,
  Sofa,
  Sun,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import FloorPlanView from "./components/FloorPlanView";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import {
  api,
  ago,
  isFresh,
  number,
  type Sensor,
  type Room,
  type Candidate,
  type Settings,
  type Summary,
  type Reading,
} from "./api";

const colors = ["#537f72", "#b89367", "#8584ab", "#739bb3", "#b47d89"];
function RoomIcon({ name, size = 21 }: { name: string; size?: number }) {
  const lower = name.toLowerCase();
  const Icon = lower.includes("bed")
    ? BedDouble
    : lower.includes("living")
      ? Sofa
      : lower.includes("office")
        ? Monitor
        : lower.includes("bath")
          ? Droplets
          : DoorOpen;
  return <Icon size={size} />;
}
function App() {
  const qc = useQueryClient();
  const [page, setPage] = useState("Overview");
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [edit, setEdit] = useState<Sensor | null>(null);
  const [selected, setSelected] = useState("");
  const [range, setRange] = useState("24h");
  const [metric, setMetric] = useState<"temperature_c" | "humidity_percent">(
    "temperature_c",
  );
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [message, setMessage] = useState("");
  const [live, setLive] = useState(false);
  const [roomDialog, setRoomDialog] = useState(false);
  const [help, setHelp] = useState(false);
  const sensors = useQuery({
    queryKey: ["sensors"],
    queryFn: () => api<Sensor[]>("/sensors"),
    refetchInterval: 10000,
  });
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api<Room[]>("/rooms"),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ mock: boolean; bluetooth: string }>("/health"),
    refetchInterval: 10000,
  });
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<Summary>("/dashboard/summary"),
    refetchInterval: 10000,
  });
  const items = sensors.data ?? [];
  const active = selected || items[0]?.id;
  const selectedSensor = items.find((s) => s.id === active);
  const rangeError =
    range === "custom" &&
    (!customStart ||
      !customEnd ||
      new Date(customStart) >= new Date(customEnd));
  const start =
    range === "custom"
      ? customStart
        ? new Date(customStart).toISOString()
        : ""
      : new Date(
          Date.now() -
            ({ "24h": 1, "7d": 7, "30d": 30 }[range] ?? 1) * 86400000,
        ).toISOString();
  const end =
    range === "custom"
      ? customEnd
        ? new Date(customEnd).toISOString()
        : ""
      : new Date().toISOString();
  const params = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const history = useQuery({
    queryKey: ["history", active, range, customStart, customEnd],
    queryFn: () => api<Reading[]>(`/sensors/${active}/readings?${params}`),
    enabled: !!active && !rangeError,
    refetchInterval: 30000,
  });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket;
    function connect() {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/readings`,
      );
      ws.onopen = () => setLive(true);
      ws.onmessage = (e) => {
        if (JSON.parse(e.data).type !== "heartbeat") {
          [
            "sensors",
            "summary",
            "history",
            "sparkline",
            "health",
            "floor-plan",
          ].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
        }
      };
      ws.onclose = () => {
        setLive(false);
        if (!stopped) timer = setTimeout(connect, 2500);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [qc]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        settings.data?.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : (settings.data?.theme ?? "light"));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.data?.theme]);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(""), 6000);
      return () => clearTimeout(t);
    }
  }, [message]);
  const refresh = () => {
    qc.invalidateQueries();
  };
  const filtered = items.filter((s) => !roomFilter || s.room_id === roomFilter);
  async function exportCsv() {
    try {
      const response = await fetch(`/api/sensors/${active}/export?${params}`);
      if (!response.ok)
        throw new Error("Export failed. Check your date range.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "thermonest-readings.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={() => {
            setPage("Overview");
            setRoomFilter(null);
          }}
        >
          <div className="brand-icon">
            <Wind size={23} />
          </div>
          <span>
            ThermoNest
            <span className="brand-sub">A little closer to home.</span>
          </span>
        </a>
        <div className="home-switch">
          <span className="home-avatar">
            <Home size={19} />
          </span>
          <div>
            My home<small>Local workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {[
            ["Overview", LayoutGrid],
            ["History", Activity],
            ["Floor plan", Map],
            ["Sensors", Radio],
          ].map(([name, Icon]) => (
            <button
              key={name as string}
              className={`nav-item ${page === name && !roomFilter ? "active" : ""}`}
              onClick={() => {
                setPage(name as string);
                setRoomFilter(null);
              }}
            >
              <Icon size={18} />
              <span>{name as string}</span>
              {name === "Sensors" && (
                <span className="nav-count">{items.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-caption room-heading">
          YOUR ROOMS
          <button aria-label="Manage rooms" onClick={() => setRoomDialog(true)}>
            <Plus size={15} />
          </button>
        </div>
        <nav>
          {rooms.data?.map((room) => (
            <button
              key={room.id}
              className={`nav-item ${roomFilter === room.id ? "active" : ""}`}
              onClick={() => {
                setPage("Overview");
                setRoomFilter(room.id);
              }}
            >
              <RoomIcon name={room.name} size={17} />
              <span>{room.name}</span>
              <span className="room-dot" />
            </button>
          ))}
          {!rooms.data?.length && (
            <p className="nav-empty">
              A place for every sensor.
              <br />
              <button onClick={() => setRoomDialog(true)}>
                Add your first room <Plus size={12} />
              </button>
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <div className="local-note-icon">
              <ShieldCheck size={18} />
              <span>At home. On your Mac.</span>
            </div>
            <p>
              Your climate data stays yours.
              <br />
              No cloud. No account. Just home.
            </p>
          </div>
          <button
            className={`nav-item ${page === "Settings" ? "active" : ""}`}
            onClick={() => {
              setPage("Settings");
              setRoomFilter(null);
            }}
          >
            <SettingsIcon size={18} />
            Settings
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            Help & about
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <span className="dot" />
            All data stored locally<span>v0.2</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Home size={15} />
            <ChevronRight size={13} />
            <span>My home</span>
            <ChevronRight size={13} />
            <strong>
              {roomFilter
                ? rooms.data?.find((r) => r.id === roomFilter)?.name
                : page}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`dot ${live ? "" : "muted"}`} />
            {live ? "Live updates" : "Reconnecting"}
            <span className="divider" />
            <button
              aria-label="Toggle color theme"
              onClick={async () => {
                try {
                  await api("/settings", "PATCH", {
                    theme:
                      document.documentElement.dataset.theme === "dark"
                        ? "light"
                        : "dark",
                  });
                  refresh();
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <Sun size={17} />
            </button>
          </div>
        </header>
        <main>
          {health.data?.mock && (
            <div className="demo-banner">
              <Radio size={15} />
              <strong>Demo workspace</strong>
              <span>
                Simulated sensors · stored separately from your real home
              </span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR HOME, IN BALANCE</div>
              <h1>
                {page === "Overview"
                  ? roomFilter
                    ? rooms.data?.find((r) => r.id === roomFilter)?.name
                    : "A feel for every room."
                  : page === "History"
                    ? "The bigger picture."
                    : page === "Sensors"
                      ? "Small sensors. Clear insights."
                      : page === "Floor plan"
                        ? "A warmer view of home."
                        : "Make yourself at home."}
              </h1>
              <p>
                {page === "Overview"
                  ? "Your home's climate, at a glance."
                  : page === "History"
                    ? "See how your home changes, hour by hour."
                    : page === "Sensors"
                      ? "Your connected devices, all in one place."
                      : page === "Floor plan"
                        ? "Your floor plan. Your sensors. Every degree in its place."
                        : "A few thoughtful details, just the way you like them."}
              </p>
            </div>
            <Button onClick={() => setWizard(true)}>
              <Plus size={16} />
              Add sensor
            </Button>
          </div>
          {(sensors.error || settings.error) && (
            <div role="alert" className="error-banner">
              {(sensors.error || settings.error)?.message}
              <Button variant="ghost" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {page === "Floor plan" ? (
            <FloorPlanView
              sensors={items}
              sampling={settings.data?.sampling_seconds ?? 120}
              notify={setMessage}
            />
          ) : page === "Settings" ? (
            <SettingsPanel
              settings={settings.data}
              refresh={refresh}
              notify={setMessage}
            />
          ) : (
            <>
              <section className="stats-grid">
                <div className="stat">
                  <span className="stat-label">
                    <Thermometer size={16} />
                    Average temperature
                  </span>
                  <div className="stat-value">
                    {number(summary.data?.temperature_c)}
                    <span>°C</span>
                  </div>
                  <span className="stat-foot">
                    Across rooms with fresh readings
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">
                    <Droplets size={16} />
                    Average humidity
                  </span>
                  <div className="stat-value">
                    {number(summary.data?.humidity_percent, 0)}
                    <span>%</span>
                  </div>
                  <span className="stat-foot">
                    A little perspective on your home
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">
                    <Radio size={16} />
                    Connected sensors
                  </span>
                  <div className="stat-value">
                    {summary.data?.online ?? 0}
                    <span className="stat-of">/ {items.length}</span>
                    <span className="pill green">
                      {summary.data?.offline ?? 0} offline
                    </span>
                  </div>
                  <span className="stat-foot">
                    <span className="dot" />
                    {health.data?.bluetooth ?? "Connecting to local service"}
                  </span>
                </div>
              </section>
              {page !== "History" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>
                        {page === "Sensors" ? "Your sensors" : "Your rooms"}
                        <span className="count-badge">{filtered.length}</span>
                      </h2>
                      <p>
                        {page === "Sensors"
                          ? "Select a device to rename, move, or reconnect it."
                          : "A small window into every corner of home."}
                      </p>
                    </div>
                    <span className="updated">
                      Updated{" "}
                      {ago(summary.data?.last_updated ?? null).toLowerCase()}
                    </span>
                  </div>
                  {sensors.isLoading ? (
                    <div className="empty-state">
                      <LoaderCircle className="spin" />
                      Getting your home ready…
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <Leaf size={32} />
                      </div>
                      <h3>A comfortable home starts here.</h3>
                      <p>
                        Add a Xiaomi climate sensor to see your room’s
                        temperature,
                        <br />
                        humidity, and little changes throughout the day.
                      </p>
                      <Button onClick={() => setWizard(true)}>
                        <Bluetooth size={16} />
                        Find your first sensor
                      </Button>
                      <small>
                        LYWSD03MMC · Stock firmware · No gateway needed
                      </small>
                    </div>
                  ) : (
                    <div className="sensor-grid">
                      {filtered.map((sensor, i) => (
                        <SensorCard
                          key={sensor.id}
                          sensor={sensor}
                          color={colors[i % colors.length]}
                          sampling={settings.data?.sampling_seconds ?? 120}
                          onClick={() => {
                            setSelected(sensor.id);
                            if (page === "Sensors") setEdit(sensor);
                          }}
                          onEdit={() => setEdit(sensor)}
                          selected={active === sensor.id}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              {(page === "Overview" || page === "History") && (
                <section className="history-panel">
                  <div className="history-heading">
                    <div>
                      <h2>Every little change.</h2>
                      <p>
                        {selectedSensor
                          ? `${selectedSensor.room_name ?? selectedSensor.display_name} · ${selectedSensor.display_name}`
                          : "Your room’s story, over time."}
                      </p>
                    </div>
                    <div className="history-actions">
                      <select
                        aria-label="Chart sensor"
                        value={active ?? ""}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        <option value="" disabled>
                          Select a sensor
                        </option>
                        {items.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.room_name ?? s.display_name}
                          </option>
                        ))}
                      </select>
                      <div className="segmented">
                        {["24h", "7d", "30d", "custom"].map((r) => (
                          <button
                            className={range === r ? "selected" : ""}
                            key={r}
                            onClick={() => setRange(r)}
                          >
                            {r === "custom" ? "Custom" : r}
                          </button>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        aria-label="Export history as CSV"
                        disabled={!active || !!rangeError}
                        onClick={exportCsv}
                      >
                        <ArrowDownToLine size={16} />
                      </Button>
                    </div>
                  </div>
                  <div className="chart-toolbar">
                    <div className="metric-tabs">
                      <button
                        className={metric === "temperature_c" ? "active" : ""}
                        onClick={() => setMetric("temperature_c")}
                      >
                        <span className="metric-dot" />
                        Temperature
                      </button>
                      <button
                        className={
                          metric === "humidity_percent" ? "active" : ""
                        }
                        onClick={() => setMetric("humidity_percent")}
                      >
                        <span className="metric-dot blue" />
                        Humidity
                      </button>
                    </div>
                    <span className="chart-unit">
                      {metric === "temperature_c"
                        ? "Degrees Celsius (°C)"
                        : "Relative humidity (%)"}
                    </span>
                  </div>
                  {range === "custom" && (
                    <div className="custom-range">
                      <label>
                        From
                        <input
                          aria-label="Range start"
                          type="datetime-local"
                          value={customStart}
                          onChange={(e) => setCustomStart(e.target.value)}
                        />
                      </label>
                      <label>
                        To
                        <input
                          aria-label="Range end"
                          type="datetime-local"
                          value={customEnd}
                          onChange={(e) => setCustomEnd(e.target.value)}
                        />
                      </label>
                      {rangeError && (
                        <small>Choose a start and end time.</small>
                      )}
                    </div>
                  )}
                  {history.error ? (
                    <div className="chart-empty">{history.error.message}</div>
                  ) : history.data?.length && !rangeError ? (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={245}>
                        <AreaChart
                          data={history.data}
                          margin={{ top: 15, right: 10, left: -25, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient
                              id="chartFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor={
                                  metric === "temperature_c"
                                    ? "#6b9283"
                                    : "#73a2bc"
                                }
                                stopOpacity={0.22}
                              />
                              <stop
                                offset="100%"
                                stopColor={
                                  metric === "temperature_c"
                                    ? "#6b9283"
                                    : "#73a2bc"
                                }
                                stopOpacity={0.01}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            vertical={false}
                            stroke="var(--line)"
                            strokeDasharray="3 5"
                          />
                          <XAxis
                            dataKey="timestamp"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleString(
                                undefined,
                                range === "24h"
                                  ? { hour: "2-digit", minute: "2-digit" }
                                  : { month: "short", day: "numeric" },
                              )
                            }
                            tickLine={false}
                            axisLine={false}
                            minTickGap={60}
                            tick={{ fontSize: 11, fill: "var(--muted)" }}
                            dy={10}
                          />
                          <YAxis
                            domain={
                              metric === "humidity_percent"
                                ? [0, 100]
                                : ["auto", "auto"]
                            }
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 11, fill: "var(--muted)" }}
                            tickFormatter={(v) => number(v, 1)}
                          />
                          <Tooltip
                            labelFormatter={(v) => new Date(v).toLocaleString()}
                            formatter={(v: number) => [
                              `${number(v)}${metric === "temperature_c" ? " °C" : "%"}`,
                              metric === "temperature_c"
                                ? "Temperature"
                                : "Humidity",
                            ]}
                            contentStyle={{
                              background: "var(--card)",
                              border: "1px solid var(--line)",
                              borderRadius: 10,
                              fontSize: 12,
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey={metric}
                            stroke={
                              metric === "temperature_c" ? "#648e7c" : "#73a2bc"
                            }
                            strokeWidth={2.5}
                            fill="url(#chartFill)"
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="chart-empty">
                      <Activity size={27} />
                      <strong>
                        {history.isFetching
                          ? "Loading history…"
                          : "A story worth waiting for."}
                      </strong>
                      <span>
                        {active
                          ? "Readings appear here as your sensor reports them."
                          : "Connect a sensor to begin your climate history."}
                      </span>
                    </div>
                  )}
                  <div className="chart-footer">
                    <span>
                      <span className="dot" />
                      Stored on this Mac · Times shown in your timezone
                    </span>
                    <span>{history.data?.length ?? 0} chart points</span>
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <Leaf size={14} />A little more awareness. A little more comfort.
            </span>
            <span>
              <ShieldCheck size={13} />
              Private by nature.
            </span>
          </footer>
        </main>
      </div>
      <Discovery
        open={wizard}
        close={() => setWizard(false)}
        rooms={rooms.data ?? []}
        sensors={items}
        refresh={refresh}
        notify={setMessage}
      />
      {edit && (
        <EditSensor
          sensor={edit}
          rooms={rooms.data ?? []}
          close={() => setEdit(null)}
          refresh={refresh}
          notify={setMessage}
        />
      )}
      <RoomManager
        open={roomDialog}
        close={() => setRoomDialog(false)}
        rooms={rooms.data ?? []}
        refresh={refresh}
      />
      <Dialog
        open={help}
        onOpenChange={setHelp}
        title="A quieter way to know your home."
        description="ThermoNest · Your home's climate, at a glance."
      >
        <div className="help-copy">
          <p>
            ThermoNest reads Xiaomi LYWSD03MMC sensors over Bluetooth and keeps
            history on this Mac. No cloud, account, gateway, or firmware
            flashing is required.
          </p>
          <h3>Having trouble connecting?</h3>
          <p>
            Enable Bluetooth and allow ThermoNest in System Settings → Privacy &
            Security → Bluetooth. Keep sensors nearby and close other apps
            connected to them.
          </p>
          <h3>Encrypted advertisements</h3>
          <p>
            Stock GATT is tried automatically. Passive MiBeacon v4/v5 packets
            require your sensor’s bind key, which is saved only in macOS
            Keychain. Some firmware revisions may restrict GATT access.
          </p>
          <h3>A note on readings</h3>
          <p>
            Battery percentage is shown only when reported by the device. Old
            values are marked stale. Demo data lives in a separate database.
          </p>
        </div>
      </Dialog>
      {message && (
        <div className="toast" role="status">
          {message}
          <button aria-label="Dismiss" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function SensorCard({
  sensor,
  color,
  sampling,
  onClick,
  onEdit,
  selected,
}: {
  sensor: Sensor;
  color: string;
  sampling: number;
  onClick: () => void;
  onEdit: () => void;
  selected: boolean;
}) {
  const fresh = isFresh(sensor, sampling);
  const history = useQuery({
    queryKey: ["sparkline", sensor.id],
    queryFn: () => api<Reading[]>(`/sensors/${sensor.id}/readings`),
    refetchInterval: 60000,
  });
  return (
    <article
      className={`sensor-card ${selected ? "chosen" : ""} ${!fresh ? "not-fresh" : ""}`}
      style={{ "--accent": color } as React.CSSProperties}
    >
      <div className="card-top">
        <span className="room-icon">
          <RoomIcon name={sensor.room_name ?? sensor.display_name} />
        </span>
        <button
          className="sensor-options"
          aria-label={`Edit ${sensor.display_name}`}
          onClick={onEdit}
        >
          ···
        </button>
      </div>
      <button className="sensor-main" onClick={onClick}>
        <h3>{sensor.room_name ?? sensor.display_name}</h3>
        <span className="sensor-name">
          {sensor.room_name ? sensor.display_name : sensor.model}
        </span>
        <div className="climate-value">
          {number(sensor.temperature_c)}
          <span>°C</span>
        </div>
        <div className="humidity">
          <Droplets size={14} />
          {number(sensor.humidity_percent, 0)}
          <span>% humidity</span>
        </div>
      </button>
      <div className="sparkline">
        {history.data?.length ? (
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={history.data}>
              <Area
                dataKey="temperature_c"
                type="monotone"
                stroke={color}
                fill={color}
                fillOpacity={0.07}
                strokeWidth={1.6}
                isAnimationActive={false}
              />
              <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <span>Waiting for a little history</span>
        )}
      </div>
      <div className="card-status">
        <span className={`status-label ${fresh ? "fresh" : ""}`}>
          <span className={`dot ${fresh ? "" : "muted"}`} />
          {!fresh && sensor.last_seen ? "Stale · " : ""}
          {sensor.status}
        </span>
        <span className="battery">
          <Battery size={14} />
          {sensor.battery_level == null ? "—" : `${sensor.battery_level}%`}
        </span>
      </div>
      <div className="card-seen">
        <span>{ago(sensor.last_seen)}</span>
        <span title="Signal strength from last scan">
          <Signal size={11} />
          {sensor.rssi == null ? "—" : `${sensor.rssi} dBm`}
        </span>
      </div>
      {sensor.error && <p className="sensor-error">{sensor.error}</p>}
    </article>
  );
}

function Discovery({
  open,
  close,
  rooms,
  sensors,
  refresh,
  notify,
}: {
  open: boolean;
  close: () => void;
  rooms: Room[];
  sensors: Sensor[];
  refresh: () => void;
  notify: (s: string) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [choice, setChoice] = useState<Candidate | null>(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState("");
  async function scan() {
    setScanning(true);
    setAttempted(true);
    setError("");
    try {
      setCandidates(await api<Candidate[]>("/sensors/discover", "POST"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }
  async function save() {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      if (replace)
        await api(`/sensors/${replace}`, "PATCH", {
          device_identifier: choice.device_identifier,
        });
      else
        await api("/sensors", "POST", {
          device_identifier: choice.device_identifier,
          display_name: name,
          room_id: room || null,
        });
      refresh();
      notify(
        replace
          ? "Sensor reconnected. Existing history preserved."
          : "Sensor added. Waiting for its first reading.",
      );
      close();
      setChoice(null);
      setReplace("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title={choice ? "Give your sensor a home." : "Let’s find your sensors."}
      description={
        choice
          ? "Choose a name and room so every reading has a place."
          : "Keep your Xiaomi LYWSD03MMC nearby and Bluetooth switched on."
      }
    >
      {!choice ? (
        <>
          <div className="scan-illustration">
            <div className={`scan-ring ${scanning ? "scanning" : ""}`}>
              <Bluetooth size={32} />
            </div>
          </div>
          <Button className="full-width" disabled={scanning} onClick={scan}>
            {scanning ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Search size={16} />
            )}
            {scanning
              ? "Looking for nearby sensors…"
              : attempted
                ? "Scan again"
                : "Scan for sensors"}
          </Button>
          <div className="candidate-list">
            {candidates.map((c) => {
              const added = sensors.some(
                (s) => s.device_identifier === c.device_identifier,
              );
              return (
                <button
                  key={c.device_identifier}
                  disabled={added}
                  onClick={() => {
                    setChoice(c);
                    setName(c.name);
                    setError("");
                  }}
                >
                  <Radio size={20} />
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.device_identifier}</small>
                    <small>
                      {c.verified
                        ? "MiBeacon model identified"
                        : "Candidate · GATT validation pending"}
                      {c.encrypted ? " · Encrypted advertisements" : ""}
                    </small>
                  </span>
                  <span>
                    {added ? (
                      <Check size={18} />
                    ) : (
                      <>
                        {c.rssi} dBm
                        <ChevronRight size={15} />
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {attempted && !scanning && !candidates.length && !error && (
            <p className="hint">
              No compatible candidates found. Move a sensor closer and try
              again.
            </p>
          )}
          <p className="hint">
            Identical names? Bring one sensor close at a time and compare signal
            strength. The full peripheral identifier distinguishes each device.
          </p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="form-stack">
            <label>
              Sensor name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Room
              <select
                aria-label="Room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
              >
                <option value="">Unassigned</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {sensors.length > 0 && (
              <label>
                Reconnect an existing sensor instead
                <select
                  value={replace}
                  onChange={(e) => setReplace(e.target.value)}
                >
                  <option value="">Register as a new sensor</option>
                  {sensors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name} · preserve history
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="hint">
              Local registration does not pair through Xiaomi Cloud.
              Compatibility is checked when ThermoNest connects.
            </p>
            <div className="dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setChoice(null)}
              >
                Back
              </Button>
              <Button disabled={busy}>
                {busy ? "Saving…" : replace ? "Reconnect sensor" : "Add sensor"}
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function EditSensor({
  sensor,
  rooms,
  close,
  refresh,
  notify,
}: {
  sensor: Sensor;
  rooms: Room[];
  close: () => void;
  refresh: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(sensor.display_name);
  const [room, setRoom] = useState(sensor.room_id ?? "");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  async function action(
    fn: () => Promise<unknown>,
    success: string,
    finish = true,
  ) {
    setBusy(true);
    try {
      await fn();
      refresh();
      notify(success);
      if (finish) close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="A place in your home."
      description={`${sensor.model} · ${sensor.device_identifier}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(
            () =>
              api(`/sensors/${sensor.id}`, "PATCH", {
                display_name: name,
                room_id: room || null,
              }),
            "Sensor updated.",
          );
        }}
        className="form-stack"
      >
        <label>
          Sensor name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Room
          <select
            aria-label="Room"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            <option value="">Unassigned</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy}>Save changes</Button>
      </form>
      {sensor.firmware_type !== "mock" && (
        <details className="key-details">
          <summary>Encrypted advertisements · bind key</summary>
          <p className="hint">
            Optional for passive readings. Stored in macOS Keychain. Never sent
            to the cloud.
          </p>
          <input
            type="password"
            aria-label="Bind key"
            placeholder="32 hexadecimal characters"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !/^[0-9a-fA-F]{32}$/.test(key)}
            onClick={() =>
              action(
                async () => {
                  await api(`/sensors/${sensor.id}/bind-key`, "PUT", { key });
                  setKey("");
                },
                "Bind key saved securely.",
                false,
              )
            }
          >
            Save to Keychain
          </Button>
        </details>
      )}
      <div className="delete-area">
        <p>
          {confirmDelete
            ? "Remove this sensor and permanently delete its history?"
            : "Removing a sensor also removes its historical readings."}
        </p>
        <Button
          variant="ghost"
          className="danger"
          disabled={busy}
          onClick={() =>
            confirmDelete
              ? action(
                  () => api(`/sensors/${sensor.id}`, "DELETE"),
                  "Sensor removed.",
                )
              : setConfirmDelete(true)
          }
        >
          {confirmDelete ? "Yes, delete sensor and history" : "Remove sensor"}
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
function RoomManager({
  open,
  close,
  rooms,
  refresh,
}: {
  open: boolean;
  close: () => void;
  rooms: Room[];
  refresh: () => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      title="Room for everything."
      description="Organize your sensors around the places you spend time."
    >
      <div className="room-list">
        {rooms.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              setEditing(r.id);
              setName(r.name);
            }}
          >
            <RoomIcon name={r.name} />
            {r.name}
            <span>Rename</span>
          </button>
        ))}
      </div>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(
              editing ? `/rooms/${editing}` : "/rooms",
              editing ? "PATCH" : "POST",
              {
                name,
                sort_order: editing
                  ? rooms.find((r) => r.id === editing)?.sort_order
                  : rooms.length,
              },
            );
            refresh();
            setName("");
            setEditing("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          {editing ? "Rename room" : "New room"}
          <input
            required
            maxLength={80}
            placeholder="e.g. Living Room"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button>{editing ? "Save room" : "Add room"}</Button>
        {editing && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing("");
              setName("");
            }}
          >
            Cancel rename
          </Button>
        )}
      </form>
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}
function SettingsPanel({
  settings,
  refresh,
  notify,
}: {
  settings?: Settings;
  refresh: () => void;
  notify: (s: string) => void;
}) {
  async function save(values: Partial<Settings>) {
    try {
      await api("/settings", "PATCH", values);
      refresh();
      notify("Preferences saved.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <section className="settings-panel">
      <div className="setting-row">
        <div>
          <h3>Appearance</h3>
          <p>A light touch, a darker mood, or follow your Mac.</p>
        </div>
        <div className="segmented">
          {(["light", "dark", "system"] as const).map((theme, i) => {
            const Icon = [Sun, Moon, Monitor][i];
            return (
              <button
                key={theme}
                className={settings?.theme === theme ? "selected" : ""}
                onClick={() => save({ theme })}
              >
                <Icon size={15} />
                {theme}
              </button>
            );
          })}
        </div>
      </div>
      <div className="setting-row">
        <div>
          <h3>Sampling frequency</h3>
          <p>Less frequent connections can help sensor battery life.</p>
        </div>
        <select
          aria-label="Sampling frequency"
          value={settings?.sampling_seconds ?? 120}
          onChange={(e) => save({ sampling_seconds: Number(e.target.value) })}
        >
          {[30, 60, 120, 300, 600, 1800, 3600].map((s) => (
            <option key={s} value={s}>
              {s < 60 ? `${s} seconds` : `${s / 60} minutes`}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <div>
          <h3>Local by design</h3>
          <p>Readings are saved in ~/Library/Application Support/ThermoNest/</p>
          <p>
            Bind keys stay in macOS Keychain. CSV exports are available above
            each history chart.
          </p>
        </div>
        <ShieldCheck size={27} />
      </div>
      <div className="setting-row">
        <div>
          <h3>{settings?.mock ? "Demo workspace" : "Real sensor workspace"}</h3>
          <p>
            {settings?.mock
              ? "Simulated readings are clearly labelled and stored separately."
              : "Only actual sensor measurements are displayed and stored."}
          </p>
        </div>
        <span className="pill green">
          {settings?.mock ? "Simulated" : "Local Bluetooth"}
        </span>
      </div>
    </section>
  );
}
export default App;
