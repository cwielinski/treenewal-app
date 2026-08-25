import { useQuery } from "convex/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Card, Eyebrow, Figure, Note } from "./components";
import { useDashboardState } from "./dashboardState";
import { count, money, rangeLabel } from "./format";

/**
 * Job Map.
 *
 * One pin per closed job. Colour is service line, size is value. City is
 * demand only: nothing here splits revenue or margin by city. The pin
 * count reconciles with the Overview and the Jobs screen because all three
 * read the same invoice spine.
 */

type Pin = {
  id: number;
  number: string;
  date: string;
  lat: number;
  lon: number;
  city: string;
  value: number;
  serviceLine: "production" | "phc";
  inside: boolean;
};

const METRO = L.latLngBounds([32.58, -97.58], [33.3, -96.58]);
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

const VALUE_STEPS = [
  { label: "All job values", value: 0 },
  { label: "$500 and up", value: 500 },
  { label: "$1,000 and up", value: 1000 },
  { label: "$2,500 and up", value: 2500 },
  { label: "$5,000 and up", value: 5000 },
];

function sizeFor(value: number): number {
  return value < 1500 ? 9 : value < 3000 ? 13 : value < 8000 ? 18 : 24;
}

function colorFor(line: "production" | "phc"): string {
  return line === "phc"
    ? "var(--tn-leaf-500)"
    : "color-mix(in srgb, var(--tn-bark-900) 55%, transparent)";
}

function tooltipFor(pin: Pin): string {
  const line = pin.serviceLine === "phc" ? "Plant Health Care" : "Production";
  const where = pin.city.length > 0 ? `${pin.city} · ` : "";
  return (
    `<div class="t-type">Invoice ${pin.number}</div>` +
    `<div class="t-meta">${pin.date} · ${where}${line}</div>` +
    `<div class="t-vals">${money(pin.value)}</div>`
  );
}

/** The Leaflet canvas. Kept apart from the panels so React never redraws it. */
function JobMap({
  pins,
  center,
  radiusMiles,
  focusCity,
  height,
}: {
  pins: Pin[];
  center: { lat: number; lon: number };
  radiusMiles: number;
  focusCity: string | null;
  height: number | string;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pinsRef = useRef<Pin[]>(pins);
  const focusRef = useRef<string | null>(focusCity);
  pinsRef.current = pins;
  focusRef.current = focusCity;

  // ---- create the map once
  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;
    const map = L.map(nodeRef.current, { scrollWheelZoom: true });
    map.fitBounds(METRO);

    const tileUrl = MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
      : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    L.tileLayer(tileUrl, {
      attribution: MAPTILER_KEY
        ? '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        : "© OpenStreetMap contributors",
      maxZoom: 18,
      detectRetina: true,
      crossOrigin: true,
    }).addTo(map);

    const bark500 =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--tn-bark-500")
        .trim() || "#8a8577";

    L.circle([center.lat, center.lon], {
      radius: radiusMiles * 1609.34,
      color: bark500,
      weight: 2,
      dashArray: "8 7",
      fill: true,
      fillColor: bark500,
      fillOpacity: 0.045,
      interactive: false,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const draw = () => render();
    map.on("zoomend moveend", draw);
    render();

    return () => {
      map.off("zoomend moveend", draw);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // The map is created once. Data changes are pushed in by render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- draw the pins, clustering them while zoomed out
  function render() {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const cell = 60;
    const buckets = new Map<string, { cx: number; cy: number; jobs: Pin[] }>();
    for (const pin of pinsRef.current) {
      const point = map.latLngToLayerPoint([pin.lat, pin.lon]);
      const cx = Math.floor(point.x / cell);
      const cy = Math.floor(point.y / cell);
      const key = `${cx}:${cy}`;
      const bucket = buckets.get(key) ?? { cx, cy, jobs: [] };
      bucket.jobs.push(pin);
      buckets.set(key, bucket);
    }

    const focus = focusRef.current;
    for (const bucket of buckets.values()) {
      if (bucket.jobs.length > 1 && map.getZoom() < 13) {
        const centre = map.layerPointToLatLng(
          L.point((bucket.cx + 0.5) * cell, (bucket.cy + 0.5) * cell),
        );
        const size = bucket.jobs.length > 12 ? 42 : bucket.jobs.length > 6 ? 36 : 30;
        const dim = focus !== null && bucket.jobs.every(job => job.city !== focus);
        const marker = L.marker(centre, {
          icon: L.divIcon({
            className: "",
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            html: `<div class="tn-cluster${dim ? " tn-dim" : ""}" style="width:${size}px;height:${size}px">${bucket.jobs.length}</div>`,
          }),
        });
        marker.on("click", () => {
          map.setView(marker.getLatLng(), Math.min(map.getZoom() + 2, 14));
        });
        marker.bindTooltip(`${bucket.jobs.length} jobs in this area`, {
          className: "tn-tip",
          direction: "top",
          offset: [0, -size / 2],
        });
        layer.addLayer(marker);
        continue;
      }
      for (const pin of bucket.jobs) {
        const size = sizeFor(pin.value);
        const dim = focus !== null && pin.city !== focus;
        const marker = L.marker([pin.lat, pin.lon], {
          icon: L.divIcon({
            className: "",
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            html: `<div class="tn-pin${dim ? " tn-dim" : ""}" style="width:${size}px;height:${size}px;background:${colorFor(pin.serviceLine)}"></div>`,
          }),
        });
        marker.bindTooltip(tooltipFor(pin), {
          className: "tn-tip",
          direction: "top",
          offset: [0, -size / 2],
        });
        layer.addLayer(marker);
      }
    }
  }

  // ---- redraw when the filtered set or the selected city changes
  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, focusCity]);

  // ---- pan to the selected city, or back out to the metro
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (focusCity === null) {
      map.fitBounds(METRO);
      return;
    }
    const set = pins.filter(pin => pin.city === focusCity);
    if (set.length > 0) {
      map.fitBounds(L.latLngBounds(set.map(pin => [pin.lat, pin.lon])).pad(0.25));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCity]);

  // ---- keep Leaflet in step with layout changes. The desktop and mobile
  // layouts swap at the breakpoint, so a map can be created while hidden
  // and must resize itself the moment it is shown.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const resize = () => {
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize();
      if (focusRef.current === null) map.fitBounds(METRO);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    const timer = window.setTimeout(resize, 120);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div style={{ position: "relative", height, minHeight: 0 }}>
      <div ref={nodeRef} style={{ position: "absolute", inset: 0 }} />
      <div className="tn-map-radius-tag">
        <span className="tn-map-dash" />
        Paid ad radius, {radiusMiles} miles from Southlake
      </div>
    </div>
  );
}

function Legend({ counts }: { counts?: Record<string, number> }) {
  return (
    <Card style={{ gap: 8 }}>
      <div className="tn-label">Legend</div>
      <div className="tn-legend-row">
        <span
          className="tn-legend-dot"
          style={{ background: colorFor("production") }}
        />
        Production
      </div>
      <div className="tn-legend-row">
        <span className="tn-legend-dot" style={{ background: colorFor("phc") }} />
        Plant Health Care
      </div>
      <div className="tn-legend-row" style={{ gap: 7 }}>
        {[9, 13, 18, 24].map(size => (
          <span
            key={size}
            style={{
              width: size,
              height: size,
              borderRadius: 999,
              background: "var(--tn-bark-400)",
              flex: "0 0 auto",
            }}
          />
        ))}
      </div>
      <Note>$1.5k to $8k and up</Note>
      <div className="tn-legend-row">
        <span className="tn-map-dash" />
        Paid ad radius, 15 miles
      </div>
      {counts && (
        <>
          <div className="tn-label" style={{ marginTop: 4 }}>
            Pins by customer
          </div>
          {(
            [
              ["residential", "Residential"],
              ["commercial", "Commercial"],
              ["government", "Government"],
              ["unknown", "Not recorded"],
            ] as const
          )
            .filter(([key]) => (counts[key] ?? 0) > 0)
            .map(([key, label]) => (
              <div
                key={key}
                className="tn-legend-row"
                style={{ justifyContent: "space-between" }}
              >
                <span>{label}</span>
                <span style={{ color: "var(--tn-fg-muted)" }}>{counts[key]}</span>
              </div>
            ))}
        </>
      )}
    </Card>
  );
}

function CityList({
  cities,
  selected,
  onSelect,
}: {
  cities: { city: string; jobs: number }[];
  selected: string | null;
  onSelect: (city: string | null) => void;
}) {
  const top = cities.slice(0, 12);
  return (
    <Card style={{ gap: 0, padding: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="tn-label">Cities by job count</div>
          <button
            type="button"
            className="tn-linkbtn"
            onClick={() => onSelect(null)}
          >
            Show all
          </button>
        </div>
        <Note>Selecting one pans the map.</Note>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 260, overflowY: "auto" }}>
        {top.map(row => (
          <button
            key={row.city}
            type="button"
            className={`tn-city${selected === row.city ? " on" : ""}`}
            onClick={() => onSelect(selected === row.city ? null : row.city)}
          >
            <span className="nm">{row.city}</span>
            <span className="ct">{count(row.jobs)}</span>
          </button>
        ))}
        {top.length === 0 && (
          <div style={{ padding: "0 16px 14px" }}>
            <Note>No mapped jobs in this period.</Note>
          </div>
        )}
      </div>
    </Card>
  );
}

export function MapPage() {
  const { period, line, segment } = useDashboardState();
  const [minValue, setMinValue] = useState(0);
  const [mapLine, setMapLine] = useState<"all" | "production" | "phc">("all");
  const [city, setCity] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const data = useQuery(api.mapScreen.map, { period, line, minValue, segment });

  // The screen level service line filter and the on map one compose: the
  // header filter decides what the screen is about, the map one narrows it.
  const pins = useMemo<Pin[]>(() => {
    const all = (data?.pins ?? []) as Pin[];
    return mapLine === "all" ? all : all.filter(pin => pin.serviceLine === mapLine);
  }, [data, mapLine]);

  const visible = city === null ? pins : pins.filter(pin => pin.city === city);
  const inside = visible.filter(pin => pin.inside);
  const outside = visible.filter(pin => !pin.inside);
  const avg = (set: Pin[]) =>
    set.length === 0
      ? null
      : Math.round(set.reduce((total, pin) => total + pin.value, 0) / set.length);
  const insideShare =
    visible.length > 0 ? Math.round((inside.length / visible.length) * 100) : null;

  const cities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const pin of pins) {
      const name = pin.city.trim();
      if (name.length === 0) continue;
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
    return [...totals.entries()]
      .map(([name, jobs]) => ({ city: name, jobs }))
      .sort((a, b) => b.jobs - a.jobs);
  }, [pins]);

  if (data === undefined) {
    return (
      <div style={{ padding: 24 }}>
        <Note>Loading the map.</Note>
      </div>
    );
  }

  const stats = (
    <>
      <div className="tn-mapstat">
        <div className="tn-mapstat-figure">{count(visible.length)}</div>
        <Note>Jobs mapped</Note>
      </div>
      <div className="tn-mapstat-rule" />
      <div className="tn-mapstat">
        <div className="tn-mapstat-figure">
          <span>{insideShare === null ? "No jobs" : `${insideShare}%`}</span>
          <span className="tn-mapstat-unit">inside</span>
          <span style={{ color: "var(--tn-bark-500)" }}>
            {insideShare === null ? "" : `${100 - insideShare}%`}
          </span>
          <span className="tn-mapstat-unit">outside</span>
        </div>
        <Note>Share inside the paid ad radius</Note>
      </div>
      <div className="tn-mapstat-rule" />
      <div className="tn-mapstat">
        <div className="tn-mapstat-figure">
          <span>{money(avg(inside))}</span>
          <span className="tn-mapstat-unit">inside</span>
          <span style={{ color: "var(--tn-bark-500)" }}>{money(avg(outside))}</span>
          <span className="tn-mapstat-unit">outside</span>
        </div>
        <Note>Average job value inside versus outside</Note>
      </div>
    </>
  );

  const filters = (
    <>
      <div className="tn-label">Service line</div>
      <div className="tn-seg">
        {(
          [
            ["all", "All"],
            ["production", "Production"],
            ["phc", "Plant Health"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tn-seg-btn${mapLine === key ? " on" : ""}`}
            onClick={() => setMapLine(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tn-label" style={{ marginTop: 4 }}>
        Minimum job value
      </div>
      <select
        className="tn-select"
        value={minValue}
        onChange={event => setMinValue(Number(event.target.value))}
      >
        {VALUE_STEPS.map(step => (
          <option key={step.value} value={step.value}>
            {step.label}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <div className="tn-map-page">
      {/* Desktop: panel, map, stats strip */}
      <div className="tn-map-desktop">
        <div className="tn-map-panel">
          <Card>
            <Eyebrow>Jobs mapped</Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <Figure size={30}>{count(visible.length)}</Figure>
              <Note>
                closed jobs, {rangeLabel(data.range)}
              </Note>
            </div>
            <Note>One pin per job. Colour is service line, size is value.</Note>
            {data.unmapped > 0 && (
              <Note>
                {count(data.unmapped)} closed jobs carry no coordinates and are not
                on the map.
              </Note>
            )}
          </Card>
          <Card style={{ gap: 8 }}>{filters}</Card>
          <Legend counts={data.segmentCounts} />
          <CityList cities={cities} selected={city} onSelect={setCity} />
        </div>
        <div className="tn-map-canvas">
          <JobMap
            pins={pins}
            center={data.center}
            radiusMiles={data.radiusMiles}
            focusCity={city}
            height="100%"
          />
        </div>
      </div>
      <div className="tn-map-stats">{stats}</div>

      {/* Mobile: full bleed map with a bottom sheet */}
      <div className="tn-map-mobile">
        <JobMap
          pins={pins}
          center={data.center}
          radiusMiles={data.radiusMiles}
          focusCity={city}
          height="100%"
        />
        <div className={`tn-sheet${sheetOpen ? " open" : ""}`}>
          <button
            type="button"
            className="tn-sheet-grip"
            onClick={() => setSheetOpen(open => !open)}
            aria-label={sheetOpen ? "Close filters and cities" : "Open filters and cities"}
          >
            <span className="tn-sheet-bar" />
            <span className="tn-label">Filters and cities</span>
          </button>
          <div className="tn-sheet-stats">
            <div className="tn-mapstat">
              <div className="tn-mapstat-figure">{count(visible.length)}</div>
              <Note>Jobs</Note>
            </div>
            <div className="tn-mapstat">
              <div className="tn-mapstat-figure">
                {insideShare === null ? "No jobs" : `${insideShare}%`}
              </div>
              <Note>Inside ad radius</Note>
            </div>
            <div className="tn-mapstat">
              <div className="tn-mapstat-figure">
                {money(avg(inside))} / {money(avg(outside))}
              </div>
              <Note>Avg in / out</Note>
            </div>
          </div>
          {sheetOpen && (
            <div className="tn-sheet-body">
              {filters}
              <CityList cities={cities} selected={city} onSelect={setCity} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
