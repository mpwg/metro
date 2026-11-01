import React, { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import type {
  GameState,
  Mode,
  PathStep,
  Station,
  TransitLine,
  TransitNetwork,
  Vehicle,
} from "../shared/types";
import { allLines, positionOf, vehicleLoad, waitingAt } from "./selectors";

interface Props {
  network: TransitNetwork;
  state: GameState;
  selectedLine: string;
  selectedStation?: string;
  selectedVehicle?: string;
  modes: Set<Mode>;
  onStation: (id: string) => void;
  onVehicle: (id: string) => void;
  preview?: PathStep[];
}
function VehicleLayer({
  vehicles,
  lines,
  stations,
  selected,
  onSelect,
}: {
  vehicles: Vehicle[];
  lines: TransitLine[];
  stations: Map<string, Station>;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const nodes = useRef(new Map<string, SVGGElement>());
  const previous = useRef(new Map<string, { x: number; y: number }>());
  useEffect(() => {
    const targets = new Map(
      vehicles.map((v) => [v.id, positionOf(v, lines, stations)]),
    );
    const from = new Map(previous.current);
    const started = performance.now();
    let frame = 0;
    function animate(now: number) {
      const p = Math.min(1, (now - started) / 195);
      targets.forEach((target, id) => {
        const start = from.get(id) ?? target;
        const point = {
          x: start.x + (target.x - start.x) * p,
          y: start.y + (target.y - start.y) * p,
        };
        nodes.current
          .get(id)
          ?.setAttribute("transform", `translate(${point.x} ${point.y})`);
        previous.current.set(id, point);
      });
      if (p < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [vehicles, lines, stations]);
  return (
    <g className="vehicle-layer">
      {vehicles.map((v) => {
        const line = lines.find((l) => l.id === v.lineId)!;
        if (!line) return null;
        const point = positionOf(v, lines, stations);
        return (
          <g
            key={v.id}
            ref={(node) => {
              if (node) nodes.current.set(v.id, node);
              else nodes.current.delete(v.id);
            }}
            className={`vehicle-marker ${selected === v.id ? "selected" : ""} ${v.status === "broken" ? "broken" : ""}`}
            transform={`translate(${point.x} ${point.y})`}
            role="button"
            tabIndex={0}
            aria-label={`Fahrzeug ${v.id}, Linie ${line.name}, ${vehicleLoad(v)} Fahrgäste`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(v.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(v.id);
            }}
          >
            {selected === v.id && (
              <circle r="15" fill="none" stroke="#203c3b" strokeWidth="2" />
            )}
            <rect
              x="-8"
              y="-5"
              width="16"
              height="10"
              rx="3"
              fill={v.status === "broken" ? "#ef473a" : line.color}
              stroke="white"
              strokeWidth="2"
            />
            <rect
              x="-3"
              y="-2"
              width="6"
              height="4"
              rx="1"
              fill="white"
              opacity=".9"
            />
            <title>
              {line.name} · {v.id} · {vehicleLoad(v)} Fahrgäste
            </title>
          </g>
        );
      })}
    </g>
  );
}
export default function NetworkMap(props: Props) {
  const {
    network,
    state,
    selectedLine,
    selectedStation,
    selectedVehicle,
    modes,
    onStation,
    onVehicle,
    preview,
  } = props;
  const svg = useRef<SVGSVGElement>(null);
  const stations = useMemo(
    () => new Map(network.stations.map((s) => [s.id, s])),
    [network],
  );
  const lines = useMemo(
    () => allLines(network, state),
    [network, state.replacementLines],
  );
  const bounds = useMemo(() => {
    const minX = Math.min(...network.stations.map((s) => s.x)) - 65;
    const minY = Math.min(...network.stations.map((s) => s.y)) - 55;
    return {
      x: minX,
      y: minY,
      w: Math.max(...network.stations.map((s) => s.x)) - minX + 85,
      h: Math.max(...network.stations.map((s) => s.y)) - minY + 65,
    };
  }, [network]);
  const [view, setView] = useState(bounds);
  const drag = useRef<{ x: number; y: number; view: typeof view } | undefined>(
    undefined,
  );
  const visibleLines = lines.filter((l) => modes.has(l.mode));
  const visibleStops = new Set(
    visibleLines.flatMap((l) => [...l.stops, ...(l.returnStops ?? [])]),
  );
  const activeLine = lines.find((l) => l.id === selectedLine);
  const activeStops = new Set(
    activeLine ? [...activeLine.stops, ...(activeLine.returnStops ?? [])] : [],
  );
  const interchangeCounts = useMemo(() => {
    const map = new Map<string, number>();
    network.lines
      .filter((l) => l.mode === "metro")
      .forEach((l) =>
        new Set(l.stops).forEach((id) => map.set(id, (map.get(id) ?? 0) + 1)),
      );
    return map;
  }, [network]);
  useEffect(() => {
    if (!selectedStation) return;
    const station = stations.get(selectedStation);
    if (station)
      setView((v) => ({
        ...v,
        x: station.x - v.w / 2,
        y: station.y - v.h / 2,
      }));
  }, [selectedStation, stations]);
  function zoom(factor: number) {
    setView((v) => {
      const w = Math.max(
        bounds.w * 0.13,
        Math.min(bounds.w * 1.5, v.w * factor),
      );
      const h = (w * v.h) / v.w;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });
  }
  const paths = (line: TransitLine) =>
    [line.stops, ...(line.returnStops ? [line.returnStops] : [])].map(
      (pattern, index) => (
        <polyline
          key={index}
          points={pattern
            .map((id) => stations.get(id))
            .filter(Boolean)
            .map((s) => `${s!.x},${s!.y}`)
            .join(" ")}
        />
      ),
    );
  const previewPoints = preview
    ?.map((p) => stations.get(p.stationId))
    .filter(Boolean)
    .map((s) => `${s!.x},${s!.y}`)
    .join(" ");
  return (
    <div className="map-shell" data-testid="network-map">
      <div className="map-caption">
        <span className="tiny-label">WIENER LINIENNETZ</span>
        <span>Schematische Darstellung · Normalnetz</span>
      </div>
      <svg
        ref={svg}
        className="network-map"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        aria-label="Interaktiver Wiener Netzplan"
        onWheel={(e) => {
          zoom(e.deltaY > 0 ? 1.12 : 0.89);
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[role="button"]')) return;
          drag.current = { x: e.clientX, y: e.clientY, view };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const box = svg.current!.getBoundingClientRect();
          const scale = Math.max(d.view.w / box.width, d.view.h / box.height);
          setView({
            ...d.view,
            x: d.view.x - (e.clientX - d.x) * scale,
            y: d.view.y - (e.clientY - d.y) * scale,
          });
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
      >
        <defs>
          <pattern
            id="dots"
            width="22"
            height="22"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#cccac0" />
          </pattern>
        </defs>
        <rect
          x={bounds.x - bounds.w}
          y={bounds.y - bounds.h}
          width={bounds.w * 3}
          height={bounds.h * 3}
          fill="url(#dots)"
        />
        <text
          x={bounds.x + bounds.w * 0.62}
          y={bounds.y + bounds.h * 0.64}
          className="city-word"
        >
          WIEN
        </text>
        {visibleLines
          .filter((l) => l.id !== selectedLine)
          .sort(
            (a, b) =>
              (a.mode === "metro" ? 1 : 0) - (b.mode === "metro" ? 1 : 0),
          )
          .map((l) => (
            <g
              key={l.id}
              className={`route route-${l.mode}`}
              stroke={l.color}
              opacity={l.mode === "metro" ? 0.8 : 0.28}
            >
              {paths(l)}
            </g>
          ))}
        {activeLine && modes.has(activeLine.mode) && (
          <g
            className={`route route-${activeLine.mode} active-route`}
            stroke={activeLine.color}
          >
            {paths(activeLine)}
          </g>
        )}
        {network.connectors
          .filter((c) => c.fictional)
          .map((c, i) => {
            const a = stations.get(c.stationId),
              b = stations.get(c.toStationId ?? c.stationId);
            return (
              a &&
              b && (
                <g key={i} className="fictional-link">
                  <path
                    d={
                      a.id === b.id
                        ? `M${a.x - 13} ${a.y - 13} q-15 -20 -30 0`
                        : `M${a.x} ${a.y} L${b.x} ${b.y}`
                    }
                  />
                  <title>
                    Fiktives Verbindungsgleis: {c.fromLineId} ↔ {c.toLineId}
                  </title>
                </g>
              )
            );
          })}
        {state.events
          .filter((e) => !e.resolved && e.type === "closure")
          .map((e) => {
            const a = stations.get(e.stationId),
              b = stations.get(e.toStationId ?? e.stationId);
            return (
              a &&
              b && (
                <g key={e.id} className="closure-mark">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10}>
                    ×
                  </text>
                </g>
              )
            );
          })}
        {network.stations
          .filter((s) => visibleStops.has(s.id))
          .map((s) => {
            const active = activeStops.has(s.id),
              interchange = (interchangeCounts.get(s.id) ?? 0) > 1;
            const metro = network.lines.some(
              (l) => l.mode === "metro" && l.stops.includes(s.id),
            );
            const selected = s.id === selectedStation;
            const count = waitingAt(state, s.id);
            const showLabel =
              selected || interchange || active || view.w < bounds.w * 0.48;
            return (
              <g
                key={s.id}
                className={`station ${selected ? "selected" : ""}`}
                role="button"
                tabIndex={showLabel ? 0 : -1}
                aria-label={`${s.name}, ${count} Wartende`}
                onClick={() => onStation(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onStation(s.id);
                }}
              >
                {count > 30 && (
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={Math.min(21, 8 + Math.sqrt(count) * 0.6)}
                    fill={count > 150 ? "#ee674d" : "#e9b34f"}
                    opacity=".22"
                  />
                )}
                {selected && (
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r="13"
                    fill="none"
                    stroke="#213b3a"
                    strokeWidth="2"
                  />
                )}
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={interchange ? 5.5 : metro ? 3.6 : 2.2}
                  fill="#faf9f2"
                  stroke={active ? activeLine!.color : "#53615a"}
                  strokeWidth={interchange ? 2.5 : 1.4}
                />
                <circle cx={s.x} cy={s.y} r="9" fill="transparent" />
                {showLabel && (
                  <text
                    x={s.x + 8}
                    y={s.y - 6}
                    className={`station-label ${interchange || selected ? "important" : ""}`}
                  >
                    {s.name}
                  </text>
                )}
                <title>
                  {s.name} · {count} Wartende
                </title>
              </g>
            );
          })}
        {previewPoints && (
          <polyline className="preview-path" points={previewPoints} />
        )}
        <VehicleLayer
          vehicles={state.vehicles.filter(
            (v) =>
              v.status !== "reserve" &&
              modes.has(lines.find((l) => l.id === v.lineId)?.mode ?? "metro"),
          )}
          lines={lines}
          stations={stations}
          selected={selectedVehicle}
          onSelect={onVehicle}
        />
      </svg>
      <div className="map-legend">
        <span>
          <i className="legend-train" /> Fahrzeug
        </span>
        <span>
          <i className="legend-crowd" /> Wartende
        </span>
        <span>
          <i className="legend-fictional" /> Spielverbindung
        </span>
      </div>
      <div className="map-controls">
        <button aria-label="Vergrößern" onClick={() => zoom(0.8)}>
          <Plus size={18} />
        </button>
        <button aria-label="Verkleinern" onClick={() => zoom(1.25)}>
          <Minus size={18} />
        </button>
        <button
          aria-label="Gesamtes Netz anzeigen"
          onClick={() => setView(bounds)}
        >
          <LocateFixed size={18} />
        </button>
      </div>
      <div className="map-scale">
        N ↑ <span>NICHT MASSSTABSGETREU</span>
      </div>
    </div>
  );
}
