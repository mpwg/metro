import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  BusFront,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gauge,
  GitBranch,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Save,
  Search,
  Siren,
  TrainFront,
  TramFront,
  TriangleAlert,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { network } from "../data/network";
import type {
  CommandResult,
  GameCommand,
  Mode,
  TransitLine,
} from "../shared/types";
import NetworkMap from "./NetworkMap";
import {
  allLines,
  clock,
  serviceStops,
  statusLabel,
  vehicleLoad,
  waitingAt,
} from "./selectors";
import { useSimulation } from "./useSimulation";

const number = (n: number) => Math.round(n).toLocaleString("de-AT");
const modeNames = { metro: "U-Bahn", tram: "Straßenbahn", bus: "Bus" };
const modeIcons = { metro: TrainFront, tram: TramFront, bus: BusFront };
type Selection = { type: "line" | "station" | "vehicle"; id: string };
function Badge({
  line,
  small = false,
}: {
  line: TransitLine;
  small?: boolean;
}) {
  return (
    <span
      className={`line-badge ${small ? "small" : ""}`}
      style={{ background: line.color }}
    >
      {line.name}
    </span>
  );
}

export default function App() {
  const sim = useSimulation();
  const { state } = sim;
  const [selection, setSelection] = useState<Selection>({
    type: "line",
    id: "U1",
  });
  const [selectedLine, setSelectedLine] = useState("U1");
  const [modes, setModes] = useState(new Set<Mode>(["metro", "tram", "bus"]));
  const [search, setSearch] = useState("");
  const [intro, setIntro] = useState(() => {
    try {
      return !localStorage.getItem("metro:intro");
    } catch {
      return true;
    }
  });
  const [newGame, setNewGame] = useState(false);
  const [pending, setPending] = useState<{
    command: GameCommand;
    result: CommandResult;
  }>();
  const [busy, setBusy] = useState(false);
  const [targetLine, setTargetLine] = useState("U2");
  const [turnStation, setTurnStation] = useState("");
  const [eventMenu, setEventMenu] = useState(false);
  const lines = useMemo(
    () => allLines(network, state),
    [state?.replacementLines],
  );
  const line = lines.find((l) => l.id === selectedLine) ?? lines[0];
  const station =
    selection.type === "station"
      ? network.stations.find((s) => s.id === selection.id)
      : undefined;
  const vehicle =
    selection.type === "vehicle"
      ? state?.vehicles.find((v) => v.id === selection.id)
      : undefined;
  const vehicleLine = vehicle
    ? lines.find((l) => l.id === vehicle.lineId)
    : undefined;
  const activeEvents = state?.events.filter((e) => !e.resolved) ?? [];
  const waiting = state
    ? Object.values(state.waiting)
        .flat()
        .reduce((sum, g) => sum + g.count, 0)
    : 0;
  const onboard =
    state?.vehicles.reduce((sum, v) => sum + vehicleLoad(v), 0) ?? 0;
  const avgWait = state?.metrics.boarded
    ? state.metrics.totalWaitSeconds / state.metrics.boarded
    : 0;
  const lineVehicles =
    state?.vehicles.filter(
      (v) => v.lineId === line.id && v.status !== "reserve",
    ) ?? [];
  const reserve =
    state?.vehicles.filter(
      (v) => v.pool === line.pool && v.status === "reserve",
    ).length ?? 0;
  const matches =
    search.trim().length > 1
      ? network.stations
          .filter((s) =>
            s.name
              .toLocaleLowerCase("de")
              .includes(search.toLocaleLowerCase("de")),
          )
          .slice(0, 7)
      : [];
  useEffect(() => {
    if (!vehicle) return;
    setTargetLine(
      lines.find((l) => l.pool === vehicle.pool && l.id !== vehicle.lineId)
        ?.id ?? "",
    );
    setTurnStation("");
  }, [vehicle?.id, vehicle?.lineId]);
  function selectLine(id: string) {
    const l = lines.find((l) => l.id === id);
    setSelectedLine(id);
    setSelection({ type: "line", id });
    if (l) setModes((old) => new Set([...old, l.mode]));
  }
  function selectStation(id: string) {
    setSelection({ type: "station", id });
    setSearch("");
    if (!line.stops.includes(id) && !line.returnStops?.includes(id)) {
      const l = lines.find(
        (l) => l.stops.includes(id) || l.returnStops?.includes(id),
      );
      if (l) {
        setSelectedLine(l.id);
        setModes((old) => new Set([...old, l.mode]));
      }
    }
  }
  function selectVehicle(id: string) {
    const v = state?.vehicles.find((v) => v.id === id);
    if (v) {
      setSelectedLine(v.lineId);
      setSelection({ type: "vehicle", id });
    }
  }
  async function act(command: GameCommand, preview = false) {
    setBusy(true);
    try {
      const result = await sim.command(command, preview);
      if (preview && result.ok) {
        setPending({ command, result });
        sim.pause();
      } else sim.setNotice(result.message);
    } finally {
      setBusy(false);
    }
  }
  function toggleMode(mode: Mode) {
    setModes((old) => {
      const next = new Set(old);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }
  function eventTarget() {
    return { stationId: station?.id, lineId: vehicle?.lineId ?? selectedLine };
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest("input,select,textarea,button") ||
        intro ||
        newGame ||
        pending
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        sim.togglePause();
      }
      if (e.key === "Escape") {
        setEventMenu(false);
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim.paused, intro, newGame, pending]);
  if (sim.error)
    return (
      <main className="fatal">
        <TriangleAlert size={38} />
        <h1>Die Leitstelle braucht einen Neustart.</h1>
        <p>{sim.error}</p>
        <button className="primary" onClick={() => location.reload()}>
          Seite neu laden
        </button>
      </main>
    );
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Metro Startseite">
          <span className="brand-symbol">M</span>
          <span>
            metro<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="brand-description">
          WIEN<span>BETRIEBSLEITSTELLE</span>
        </div>
        <div className={`operation-status ${sim.paused ? "is-paused" : ""}`}>
          <i />
          {sim.paused ? "BETRIEB PAUSIERT" : "BETRIEB LÄUFT"}
        </div>
        <div className="top-actions">
          <button className="quiet" onClick={sim.save} disabled={!state}>
            <Save size={16} /> Speichern
          </button>
          <button
            className="icon-button"
            aria-label="Einführung öffnen"
            onClick={() => {
              sim.pause();
              setIntro(true);
            }}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="left-sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="eyebrow">DEIN NETZ</span>
              <h2>
                Alle Linien<span>{lines.length}</span>
              </h2>
            </div>
            <GitBranch size={20} />
          </div>
          <div className="line-groups">
            {(["metro", "tram", "bus"] as Mode[]).map((mode) => {
              const Icon = modeIcons[mode];
              return (
                <section className="line-group" key={mode}>
                  <h3>
                    <Icon size={14} />
                    {modeNames[mode]}
                  </h3>
                  {lines
                    .filter((l) => l.mode === mode)
                    .map((l) => {
                      const count =
                        state?.vehicles.filter(
                          (v) => v.lineId === l.id && v.status !== "reserve",
                        ).length ?? 0;
                      const incident = activeEvents.some(
                        (e) => e.lineId === l.id,
                      );
                      return (
                        <button
                          key={l.id}
                          className={`line-row ${selectedLine === l.id ? "active" : ""}`}
                          onClick={() => selectLine(l.id)}
                          aria-label={`Linie ${l.name} auswählen`}
                          aria-pressed={selectedLine === l.id}
                        >
                          <Badge line={l} small />
                          <span className="line-terminal">
                            {network.stations.find(
                              (s) => s.id === l.stops.at(-1),
                            )?.name ?? "Ersatzverkehr"}
                          </span>
                          {incident && <span className="incident-dot" />}
                          <span className="line-count">{count}</span>
                          <ChevronRight size={12} />
                        </button>
                      );
                    })}
                </section>
              );
            })}
          </div>
          <div className="sidebar-foot">
            <div>
              <span className="eyebrow">FAHRZEUGBESTAND</span>
              <strong>
                {state?.vehicles.filter((v) => v.status !== "reserve").length ??
                  "—"}{" "}
                <small>im Einsatz</small>
              </strong>
            </div>
            <span className="reserve-total">
              {state?.vehicles.filter((v) => v.status === "reserve").length ??
                "—"}{" "}
              Reserve
            </span>
          </div>
        </aside>
        <section className="center-column">
          <div className="map-toolbar">
            <div className="mode-filters">
              {(["metro", "tram", "bus"] as Mode[]).map((mode) => {
                const Icon = modeIcons[mode];
                return (
                  <button
                    key={mode}
                    className={modes.has(mode) ? "enabled" : ""}
                    aria-pressed={modes.has(mode)}
                    onClick={() => toggleMode(mode)}
                  >
                    <Icon size={15} />
                    {mode === "tram" ? "Bim" : modeNames[mode]}
                  </button>
                );
              })}
            </div>
            <div className="search-box">
              <Search size={15} />
              <input
                aria-label="Station suchen"
                placeholder="Station suchen"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0])
                    selectStation(matches[0].id);
                }}
              />
              {search && (
                <button aria-label="Suche leeren" onClick={() => setSearch("")}>
                  <X size={13} />
                </button>
              )}
              {search.length > 1 && (
                <div className="search-results">
                  {matches.length ? (
                    matches.map((s) => (
                      <button key={s.id} onClick={() => selectStation(s.id)}>
                        <MapPin size={13} />
                        {s.name}
                      </button>
                    ))
                  ) : (
                    <p>Keine Station gefunden.</p>
                  )}
                </div>
              )}
            </div>
          </div>
          {state ? (
            <NetworkMap
              network={network}
              state={state}
              selectedLine={selectedLine}
              selectedStation={station?.id}
              selectedVehicle={vehicle?.id}
              modes={modes}
              onStation={selectStation}
              onVehicle={selectVehicle}
              preview={pending?.result.path}
            />
          ) : (
            <div className="loading">
              <span className="loader" />
              <h2>Die Stadt wacht auf.</h2>
              <p>Das Wiener Netz wird geladen …</p>
            </div>
          )}
          <div className="simulation-bar">
            <div className="game-time">
              <Clock3 size={17} />
              <strong>{clock(state?.time ?? 25200)}</strong>
              <span>SPIELZEIT</span>
            </div>
            <div className="playback">
              <button
                className={`play-button ${sim.paused ? "paused" : ""}`}
                onClick={sim.togglePause}
                disabled={!state}
                aria-label={
                  sim.paused ? "Simulation starten" : "Simulation pausieren"
                }
              >
                {sim.paused ? (
                  <Play size={17} fill="currentColor" />
                ) : (
                  <Pause size={17} fill="currentColor" />
                )}
              </button>
              {([1, 2, 5] as const).map((speed) => (
                <button
                  key={speed}
                  className={sim.speed === speed ? "active" : ""}
                  aria-label={`${speed}-fache Geschwindigkeit`}
                  aria-pressed={sim.speed === speed}
                  onClick={() => sim.setSpeed(speed)}
                >
                  {speed}×
                </button>
              ))}
            </div>
            <span className="keyboard-hint">Leertaste zum Pausieren</span>
          </div>
          <div className="metrics-strip">
            <div>
              <span>
                <Users size={15} /> BEFÖRDERTE FAHRGÄSTE
              </span>
              <strong data-testid="completed-count">
                {number(state?.metrics.completed ?? 0)}
              </strong>
              <small>{number(onboard)} gerade unterwegs</small>
            </div>
            <div>
              <span>
                <Clock3 size={15} /> MITTLERE WARTEZEIT
              </span>
              <strong>
                {avgWait > 0
                  ? `${(avgWait / 60).toFixed(1).replace(".", ",")}`
                  : "—"}
                <em>{avgWait > 0 ? " min" : ""}</em>
              </strong>
              <small>bei bisherigem Einstieg</small>
            </div>
            <div>
              <span>
                <Gauge size={15} /> AN HALTESTELLEN
              </span>
              <strong>{number(waiting)}</strong>
              <small>
                {number(state?.metrics.abandoned ?? 0)} Fahrten aufgegeben
              </small>
            </div>
          </div>
        </section>
        <aside className="right-sidebar">
          <section className="selection-panel">
            <div className="panel-kicker">
              <span className="eyebrow">
                {station
                  ? "HALTESTELLE"
                  : vehicle
                    ? "FAHRZEUG"
                    : "LINIENÜBERSICHT"}
              </span>
              {selection.type !== "line" && (
                <button
                  aria-label="Zur Linienübersicht"
                  onClick={() =>
                    setSelection({ type: "line", id: selectedLine })
                  }
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {station && state ? (
              <>
                <h2 className="station-title">{station.name}</h2>
                <div className="station-lines">
                  {lines
                    .filter(
                      (l) =>
                        l.stops.includes(station.id) ||
                        l.returnStops?.includes(station.id),
                    )
                    .map((l) => (
                      <button
                        key={l.id}
                        onClick={() => selectLine(l.id)}
                        aria-label={`Linie ${l.name} auswählen`}
                      >
                        <Badge line={l} small />
                      </button>
                    ))}
                </div>
                <div className="station-wait">
                  <Users size={24} />
                  <strong>{number(waitingAt(state, station.id))}</strong>
                  <span>Fahrgäste warten</span>
                </div>
                <p className="muted-copy">
                  Fahrgäste wählen ihre Verbindung anhand von Fahrzeit, Takt und
                  Umstiegen.
                </p>
                <button
                  className="secondary full"
                  disabled={busy}
                  onClick={() =>
                    act({
                      type: "triggerEvent",
                      eventType: "crowd",
                      stationId: station.id,
                      lineId: selectedLine,
                    })
                  }
                >
                  <Users size={15} /> Andrang auslösen
                </button>
              </>
            ) : vehicle && vehicleLine ? (
              <>
                <div className="selection-title">
                  <Badge line={vehicleLine} />
                  <div>
                    <h2>{vehicle.id}</h2>
                    <span>{statusLabel[vehicle.status]}</span>
                  </div>
                </div>
                <div className="occupancy">
                  <div>
                    <span>Auslastung</span>
                    <strong>
                      {vehicleLoad(vehicle)} / {vehicleLine.capacity}
                    </strong>
                  </div>
                  <div className="occupancy-track">
                    <i
                      style={{
                        width: `${Math.min(100, (vehicleLoad(vehicle) / vehicleLine.capacity) * 100)}%`,
                        background: vehicleLine.color,
                      }}
                    />
                  </div>
                </div>
                {vehicle.status === "broken" ? (
                  <p className="repair-message">
                    <Wrench size={16} /> Reparatur noch{" "}
                    {Math.max(
                      0,
                      Math.ceil(
                        (vehicle.repairUntil - (state?.time ?? 0)) / 60,
                      ),
                    )}{" "}
                    min
                  </p>
                ) : (
                  <div className="vehicle-actions">
                    <button
                      className="secondary"
                      disabled={busy || vehicle.status !== "service"}
                      onClick={() =>
                        act({
                          type: "hold",
                          vehicleId: vehicle.id,
                          seconds: 30,
                        })
                      }
                    >
                      <Pause size={14} /> 30 s halten
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || vehicle.status !== "service"}
                      onClick={() =>
                        act({ type: "withdraw", vehicleId: vehicle.id }, true)
                      }
                    >
                      <ArrowDownToLine size={14} /> Abziehen
                    </button>
                  </div>
                )}
                <label className="field-label" htmlFor="target-line">
                  Auf andere Linie umleiten
                </label>
                <div className="control-pair">
                  <select
                    id="target-line"
                    value={targetLine}
                    onChange={(e) => setTargetLine(e.target.value)}
                  >
                    {lines
                      .filter(
                        (l) =>
                          l.pool === vehicle.pool && l.id !== vehicle.lineId,
                      )
                      .map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="secondary"
                    aria-label="Umleitung prüfen"
                    disabled={
                      busy ||
                      vehicle.status !== "service" ||
                      !lines.some(
                        (l) =>
                          l.id === targetLine &&
                          l.pool === vehicle.pool &&
                          l.id !== vehicle.lineId,
                      )
                    }
                    onClick={() =>
                      act(
                        {
                          type: "transfer",
                          vehicleId: vehicle.id,
                          targetLineId: targetLine,
                        },
                        true,
                      )
                    }
                  >
                    <ArrowLeftRight size={16} /> Prüfen
                  </button>
                </div>
                <label className="field-label" htmlFor="turn-station">
                  Vorzeitig wenden
                </label>
                <div className="control-pair">
                  <select
                    id="turn-station"
                    value={turnStation}
                    onChange={(e) => setTurnStation(e.target.value)}
                  >
                    <option value="">Wendestation wählen</option>
                    {serviceStops(vehicleLine, vehicle.direction)
                      .slice(vehicle.stopIndex + 1)
                      .filter((id) =>
                        serviceStops(
                          vehicleLine,
                          vehicle.direction === 1 ? -1 : 1,
                        ).includes(id),
                      )
                      .map((id, i) => (
                        <option key={`${id}-${i}`} value={id}>
                          {network.stations.find((s) => s.id === id)?.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="secondary"
                    aria-label="Kurzführung prüfen"
                    disabled={
                      !turnStation || busy || vehicle.status !== "service"
                    }
                    onClick={() =>
                      act(
                        {
                          type: "shortTurn",
                          vehicleId: vehicle.id,
                          stationId: turnStation,
                        },
                        true,
                      )
                    }
                  >
                    <GitBranch size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="selection-title">
                  <Badge line={line} />
                  <div>
                    <h2>Linie {line.name}</h2>
                    <span>{modeNames[line.mode]}</span>
                  </div>
                </div>
                <div className="route-endpoints">
                  <span>
                    {network.stations.find((s) => s.id === line.stops[0])?.name}
                  </span>
                  <i />
                  <span>
                    {
                      network.stations.find((s) => s.id === line.stops.at(-1))
                        ?.name
                    }
                  </span>
                </div>
                <div className="line-stats">
                  <div>
                    <strong>{lineVehicles.length}</strong>
                    <span>im Einsatz</span>
                  </div>
                  <div>
                    <strong>{reserve}</strong>
                    <span>Reserve im Pool</span>
                  </div>
                  <div>
                    <strong>
                      {
                        new Set([...line.stops, ...(line.returnStops ?? [])])
                          .size
                      }
                    </strong>
                    <span>Stationen</span>
                  </div>
                </div>
                <button
                  className="primary full"
                  disabled={busy || !state || reserve === 0}
                  onClick={() => act({ type: "deploy", lineId: line.id })}
                >
                  <PlusIcon /> Fahrzeug einsetzen
                  <ArrowRight size={16} />
                </button>
                <div className="pool-note">
                  {line.pool === "metro"
                    ? "Gemeinsame Reserve U1–U4"
                    : line.pool === "u6"
                      ? "Eigener Fahrzeugpool der U6"
                      : line.pool === "tram"
                        ? "Gemeinsame Straßenbahnreserve"
                        : "Gemeinsame Busreserve"}{" "}
                  · Einsatz mit Anfahrtszeit
                </div>
                <div className="vehicle-list-title">
                  FAHRZEUGE <span>{lineVehicles.length}</span>
                </div>
                <div className="vehicle-list">
                  {lineVehicles.map((v) => (
                    <button key={v.id} onClick={() => selectVehicle(v.id)}>
                      <span className={`vehicle-status-dot ${v.status}`} />
                      <span>
                        {v.id}
                        <small>{statusLabel[v.status]}</small>
                      </span>
                      <span className="vehicle-pax">
                        {vehicleLoad(v)}
                        <Users size={11} />
                      </span>
                      <ChevronRight size={13} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="events-panel">
            <div className="events-heading">
              <div>
                <span className="eyebrow">LAGEBILD</span>
                <h2>
                  Ereignisse <span>{activeEvents.length}</span>
                </h2>
              </div>
              <div className="event-menu-wrap">
                <button
                  className="event-add"
                  aria-label="Ereignis auslösen"
                  onClick={() => setEventMenu((v) => !v)}
                >
                  <Zap size={16} />
                </button>
                {eventMenu && (
                  <div className="event-menu">
                    {(
                      [
                        {
                          type: "crowd",
                          label: "Fahrgastandrang",
                          Icon: Users,
                        },
                        {
                          type: "breakdown",
                          label: "Fahrzeugdefekt",
                          Icon: Wrench,
                        },
                        {
                          type: "closure",
                          label: "Streckensperre",
                          Icon: TriangleAlert,
                        },
                      ] as const
                    ).map(({ type, label, Icon }) => (
                      <button
                        key={type}
                        disabled={busy || !state}
                        onClick={() => {
                          setEventMenu(false);
                          act({
                            type: "triggerEvent",
                            eventType: type,
                            ...eventTarget(),
                          });
                        }}
                      >
                        <Icon size={15} />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="events-list">
              {activeEvents.length ? (
                activeEvents
                  .slice()
                  .reverse()
                  .map((event) => (
                    <article
                      key={event.id}
                      className={`event-card event-${event.type}`}
                    >
                      <div className="event-card-top">
                        <span>
                          {event.type === "crowd" ? (
                            <Users size={15} />
                          ) : event.type === "breakdown" ? (
                            <Wrench size={15} />
                          ) : (
                            <TriangleAlert size={15} />
                          )}
                          {event.type === "crowd"
                            ? "HOHER ANDRANG"
                            : event.type === "breakdown"
                              ? "FAHRZEUGDEFEKT"
                              : "STRECKENSPERRE"}
                        </span>
                        <time>{clock(event.startsAt)}</time>
                      </div>
                      <button
                        className="event-location"
                        onClick={() => selectStation(event.stationId)}
                      >
                        {network.stations.find((s) => s.id === event.stationId)
                          ?.name ?? event.title}
                        <ChevronRight size={14} />
                      </button>
                      <p>{event.description}</p>
                      <div className="event-bottom">
                        <span>
                          {lines.find((l) => l.id === event.lineId) && (
                            <Badge
                              line={lines.find((l) => l.id === event.lineId)!}
                              small
                            />
                          )}
                        </span>
                        <span>
                          noch{" "}
                          {Math.max(
                            1,
                            Math.ceil((event.endsAt - (state?.time ?? 0)) / 60),
                          )}{" "}
                          min
                        </span>
                      </div>
                      {event.type === "closure" && (
                        <button
                          className="secondary full"
                          disabled={busy || Boolean(event.replacementLineId)}
                          onClick={() =>
                            act({
                              type: "createReplacement",
                              eventId: event.id,
                            })
                          }
                        >
                          <BusFront size={14} />
                          {event.replacementLineId
                            ? "Ersatzlinie eingerichtet"
                            : "Ersatzbuslinie einrichten"}
                        </button>
                      )}
                    </article>
                  ))
              ) : (
                <div className="no-events">
                  <span className="calm-icon">
                    <Check size={24} />
                  </span>
                  <h3>Alles im grünen Bereich.</h3>
                  <p>
                    Dein Netz läuft nach Plan. Behalte die Auslastung im Blick.
                  </p>
                  <button onClick={() => setEventMenu(true)}>
                    Ein Ereignis auslösen <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          <i /> WIEN · {network.stations.length} HALTESTELLEN ·{" "}
          {network.lines.length} LINIEN
        </span>
        <span>
          {sim.savedAt
            ? `Lokal gespeichert ${sim.savedAt.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}`
            : "Spielstand wird lokal gespeichert"}
        </span>
        <a
          className="data-credit"
          href="https://github.com/mpwg/metro/blob/main/docs/data-sources.md"
          target="_blank"
          rel="noreferrer"
        >
          Netzdaten: Wiener Linien · CC BY 4.0
        </a>
        <button
          onClick={() => {
            sim.pause();
            setNewGame(true);
          }}
        >
          <RotateCcw size={12} /> Neues Spiel
        </button>
        <a
          href="https://github.com/mpwg/metro"
          target="_blank"
          rel="noreferrer"
        >
          Quellcode ↗
        </a>
      </footer>
      {sim.notice && (
        <div role="status" className="toast">
          <span>{sim.notice}</span>
          <button
            aria-label="Meldung schließen"
            onClick={() => sim.setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {intro && (
        <div className="modal-backdrop">
          <section
            className="intro-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="intro-title"
          >
            <div className="intro-art">
              <div className="intro-route red" />
              <div className="intro-route green" />
              <div className="intro-route gold" />
              <span className="intro-vehicle">M</span>
              <span className="intro-eyebrow">
                WILLKOMMEN IN DER LEITSTELLE
              </span>
              <h1 id="intro-title">
                Deine Stadt.
                <br />
                Dein Takt.
              </h1>
              <p>Wien ist unterwegs. Du hältst es in Bewegung.</p>
            </div>
            <div className="intro-content">
              <div className="intro-step">
                <span>01</span>
                <div>
                  <h3>Behalte das Netz im Blick.</h3>
                  <p>
                    Wähle eine Linie, Station oder ein Fahrzeug. Wartewolken
                    zeigen dir, wo es eng wird.
                  </p>
                </div>
              </div>
              <div className="intro-step">
                <span>02</span>
                <div>
                  <h3>Mach den Unterschied.</h3>
                  <p>
                    Schicke Reserven, ändere den Einsatz und richte bei Sperren
                    Ersatzbuslinien ein.
                  </p>
                </div>
              </div>
              <div className="intro-step">
                <span>03</span>
                <div>
                  <h3>Nimm dir Zeit.</h3>
                  <p>
                    Du kannst jederzeit pausieren. Dein Spiel wird auf diesem
                    Gerät gespeichert.
                  </p>
                </div>
              </div>
              <button
                className="primary full intro-start"
                disabled={!state}
                onClick={() => {
                  try {
                    localStorage.setItem("metro:intro", "1");
                  } catch {}
                  setIntro(false);
                  if (!sim.restored && sim.paused) sim.togglePause();
                }}
              >
                {state
                  ? sim.restored
                    ? "Spielstand öffnen"
                    : "Betrieb übernehmen"
                  : "Netz wird geladen …"}
                <ArrowRight size={18} />
              </button>
              <p className="intro-disclaimer">
                Eine spielerische Simulation mit echten Netzdaten und
                vereinfachten Betriebsregeln. Fiktive Verbindungen sind
                markiert.
              </p>
            </div>
          </section>
        </div>
      )}
      {pending && (
        <div className="modal-backdrop">
          <section
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-title"
          >
            <div className="dialog-icon">
              <ArrowLeftRight size={26} />
            </div>
            <span className="eyebrow">FAHRWEGVORSCHAU</span>
            <h2 id="command-title">Einsatz bestätigen</h2>
            <p>{pending.result.message}</p>
            {pending.result.path && (
              <div className="preview-stops">
                {pending.result.path
                  .filter(
                    (p, i, a) =>
                      i === 0 ||
                      p.lineId !== a[i - 1].lineId ||
                      i === a.length - 1,
                  )
                  .map((p, i) => (
                    <div key={i}>
                      <MapPin size={13} />
                      <span>
                        {network.stations.find((s) => s.id === p.stationId)
                          ?.name ?? p.stationId}
                      </span>
                      <strong>{p.lineId}</strong>
                    </div>
                  ))}
              </div>
            )}
            <p className="muted-copy">
              Der Betrieb ist pausiert. Bei der Bestätigung wird der Fahrweg
              erneut geprüft.
            </p>
            <div className="dialog-actions">
              <button
                className="secondary"
                onClick={() => setPending(undefined)}
              >
                Abbrechen
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  await act(pending.command);
                  setPending(undefined);
                }}
              >
                Bestätigen <Check size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
      {newGame && (
        <div className="modal-backdrop">
          <section
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-title"
          >
            <RotateCcw size={28} />
            <h2 id="new-title">Eine neue Schicht?</h2>
            <p>
              Dein bisheriger Spielstand wird durch einen neuen Betrieb ersetzt.
            </p>
            <div className="dialog-actions">
              <button className="secondary" onClick={() => setNewGame(false)}>
                Abbrechen
              </button>
              <button
                className="primary"
                onClick={async () => {
                  await sim.reset();
                  setSelection({ type: "line", id: "U1" });
                  setSelectedLine("U1");
                  setNewGame(false);
                }}
              >
                Neu beginnen
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function PlusIcon() {
  return <span className="plus-symbol">+</span>;
}
