import type {
  GameState,
  PassengerLeg,
  PathStep,
  TransitLine,
  TransitNetwork,
  Vehicle,
} from "../shared/types";
import { CONFIG } from "./config";
export function getServiceStops(
  line: TransitLine,
  direction: 1 | -1,
): string[] {
  return direction === 1
    ? line.stops
    : (line.returnStops ?? [...line.stops].reverse());
}
export function allLines(
  network: TransitNetwork,
  state: GameState,
): TransitLine[] {
  return [...network.lines, ...state.replacementLines];
}
export function travelTime(
  network: TransitNetwork,
  a: string,
  b: string,
  mode: string,
): number {
  const first = network.stations.find((s) => s.id === a),
    second = network.stations.find((s) => s.id === b);
  if (!first || !second) return 75;
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  // Map coordinates are layout units, so bounded durations keep schematics playable.
  return Math.round(
    Math.min(
      CONFIG.maximumTravelSeconds,
      Math.max(
        CONFIG.minimumTravelSeconds,
        distance * (mode === "bus" ? 2 : 1.25),
      ),
    ),
  );
}
export function closed(
  state: GameState,
  lineId: string,
  a: string,
  b: string,
): boolean {
  return state.events.some(
    (e) =>
      !e.resolved &&
      e.type === "closure" &&
      e.lineId === lineId &&
      ((e.stationId === a && e.toStationId === b) ||
        (e.stationId === b && e.toStationId === a)),
  );
}
type Edge = {
  to: string;
  seconds: number;
  lineId: string;
  direction?: 1 | -1;
  fromStation: string;
  toStation: string;
};
type Graph = Map<string, Edge[]>;
function add(graph: Graph, from: string, edge: Edge) {
  const list = graph.get(from) ?? [];
  list.push(edge);
  graph.set(from, list);
}
const node = (line: string, station: string, direction?: 1 | -1) =>
  JSON.stringify(
    direction === undefined ? [line, station] : [line, station, direction],
  );
function search(
  graph: Graph,
  start: string,
): {
  dist: Map<string, number>;
  prev: Map<
    string,
    {
      from: string;
      edge: Edge;
    }
  >;
} {
  // Binary heap avoids quadratic scans on the complete 18-line network.
  const heap: {
    key: string;
    cost: number;
  }[] = [];
  function push(key: string, cost: number) {
    let i = heap.length;
    heap.push({ key, cost });
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.cost <= cost) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = { key, cost };
  }
  function pop() {
    const root = heap[0]!,
      tail = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1]!.cost < heap[c]!.cost) c++;
        if (heap[c]!.cost >= tail.cost) break;
        heap[i] = heap[c]!;
        i = c;
      }
      heap[i] = tail;
    }
    return root;
  }
  const dist = new Map<string, number>([[start, 0]]),
    prev = new Map<
      string,
      {
        from: string;
        edge: Edge;
      }
    >();
  push(start, 0);
  while (heap.length) {
    const cur = pop();
    if (cur.cost !== dist.get(cur.key)) continue;
    for (const edge of graph.get(cur.key) ?? []) {
      const cost = cur.cost + edge.seconds;
      if (cost < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, cost);
        prev.set(edge.to, { from: cur.key, edge });
        push(edge.to, cost);
      }
    }
  }
  return { dist, prev };
}
function reconstruct(
  prev: Map<
    string,
    {
      from: string;
      edge: Edge;
    }
  >,
  start: string,
  end: string,
): Edge[] | undefined {
  if (start === end) return [];
  const result: Edge[] = [];
  let cur = end;
  while (cur !== start) {
    const step = prev.get(cur);
    if (!step) return;
    result.push(step.edge);
    cur = step.from;
  }
  return result.reverse();
}
interface PassengerCache {
  key: string;
  evaluatedAt: number;
  graph: Graph;
  sources: Map<
    string,
    Map<
      string,
      {
        from: string;
        edge: Edge;
      }
    >
  >;
}
// Derived cache only: no randomness or simulation history lives here, so JSON saves
// resume identically. Commands invalidate it; each next tick verifies topology again.
const cache = new WeakMap<GameState, PassengerCache>();
export function invalidateRoutes(state: GameState): void {
  cache.delete(state);
}
function passengerGraph(
  network: TransitNetwork,
  state: GameState,
): PassengerCache {
  let context = cache.get(state);
  if (context?.evaluatedAt === state.time) return context;
  const lines = allLines(network, state).filter((l) =>
    state.vehicles.some(
      (v) =>
        v.lineId === l.id && (v.status === "service" || v.status === "broken"),
    ),
  );
  const key =
    lines.map((l) => l.id).join(",") +
    "|" +
    state.events
      .filter((e) => e.type === "closure" && !e.resolved)
      .map((e) => e.id)
      .join(",");
  if (context?.key === key) {
    context.evaluatedAt = state.time;
    return context;
  }
  const graph: Graph = new Map();
  for (const line of lines) {
    // Keep the two service patterns separate: a shared station is an alight/board
    // interchange, never an implicit change of direction while staying aboard.
    for (const direction of [1, -1] as const) {
      const stops = getServiceStops(line, direction);
      for (const stop of new Set(stops)) {
        add(graph, node("", stop), {
          to: node(line.id, stop, direction),
          seconds: line.headway / 2 + CONFIG.transferPenaltySeconds,
          lineId: "",
          fromStation: stop,
          toStation: stop,
        });
        add(graph, node(line.id, stop, direction), {
          to: node("", stop),
          seconds: 0,
          lineId: "",
          fromStation: stop,
          toStation: stop,
        });
      }
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i]!,
          b = stops[i + 1]!;
        if (!closed(state, line.id, a, b))
          add(graph, node(line.id, a, direction), {
            to: node(line.id, b, direction),
            seconds: travelTime(network, a, b, line.mode) + CONFIG.dwellSeconds,
            lineId: line.id,
            direction,
            fromStation: a,
            toStation: b,
          });
      }
    }
  }
  for (const walk of network.transfers) {
    add(graph, node("", walk.from), {
      to: node("", walk.to),
      seconds: walk.seconds + CONFIG.transferPenaltySeconds,
      lineId: "@walk",
      fromStation: walk.from,
      toStation: walk.to,
    });
    add(graph, node("", walk.to), {
      to: node("", walk.from),
      seconds: walk.seconds + CONFIG.transferPenaltySeconds,
      lineId: "@walk",
      fromStation: walk.to,
      toStation: walk.from,
    });
  }
  context = { key, evaluatedAt: state.time, graph, sources: new Map() };
  cache.set(state, context);
  return context;
}
export function planJourney(
  network: TransitNetwork,
  state: GameState,
  from: string,
  destination: string,
): PassengerLeg[] {
  if (from === destination) return [];
  const context = passengerGraph(network, state);
  let prev = context.sources.get(from);
  if (!prev) {
    prev = search(context.graph, node("", from)).prev;
    context.sources.set(from, prev);
  }
  const edges = reconstruct(prev, node("", from), node("", destination));
  if (!edges) return [];
  const legs: PassengerLeg[] = [];
  let aboard = false;
  for (const edge of edges) {
    if (!edge.lineId) {
      aboard = false;
      continue;
    }
    const last = legs.at(-1);
    if (
      aboard &&
      last &&
      last.lineId === edge.lineId &&
      last.direction === edge.direction &&
      edge.lineId !== "@walk" &&
      last.alightStopId === edge.fromStation
    )
      last.alightStopId = edge.toStation;
    else
      legs.push({
        lineId: edge.lineId,
        ...(edge.direction === undefined ? {} : { direction: edge.direction }),
        boardStopId: edge.fromStation,
        alightStopId: edge.toStation,
      });
    aboard = edge.lineId !== "@walk";
  }
  return legs;
}
export function projectedStop(
  network: TransitNetwork,
  state: GameState,
  vehicle: Vehicle,
): string {
  const line = allLines(network, state).find((l) => l.id === vehicle.lineId)!;
  const stops = getServiceStops(line, vehicle.direction);
  return stops[
    Math.min(
      stops.length - 1,
      vehicle.stopIndex + (vehicle.progress > 0 ? 1 : 0),
    )
  ]!;
}
/** Physical rail/bus graph: common stations NEVER imply a cross-line track. */
export function transferPath(
  network: TransitNetwork,
  state: GameState,
  vehicle: Vehicle,
  targetLineId: string,
): PathStep[] | undefined {
  const lines = allLines(network, state).filter(
      (l) =>
        l.pool === vehicle.pool &&
        // Retiring corridors remain for already accepted paths, but cannot become
        // new intermediate shortcuts. A vehicle on one may still find its way out.
        (!state.replacementLines.some((r) => r.id === l.id) ||
          state.events.some(
            (e) => !e.resolved && e.replacementLineId === l.id,
          ) ||
          l.id === vehicle.lineId),
    ),
    graph: Graph = new Map();
  for (const line of lines)
    for (const direction of [1, -1] as const) {
      const stops = getServiceStops(line, direction);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i]!,
          b = stops[i + 1]!;
        if (!closed(state, line.id, a, b))
          add(graph, node(line.id, a), {
            to: node(line.id, b),
            seconds: travelTime(network, a, b, line.mode),
            lineId: line.id,
            fromStation: a,
            toStation: b,
          });
      }
    }
  for (const connector of network.connectors) {
    if (
      !lines.some((l) => l.id === connector.fromLineId) ||
      !lines.some((l) => l.id === connector.toLineId)
    )
      continue;
    const from = connector.stationId,
      to = connector.toStationId ?? from;
    add(graph, node(connector.fromLineId, from), {
      to: node(connector.toLineId, to),
      seconds: Math.max(1, connector.seconds),
      lineId: connector.toLineId,
      fromStation: from,
      toStation: to,
    });
    add(graph, node(connector.toLineId, to), {
      to: node(connector.fromLineId, from),
      seconds: Math.max(1, connector.seconds),
      lineId: connector.fromLineId,
      fromStation: to,
      toStation: from,
    });
  }
  // Buses can use an explicit, simplified surface corridor between the closest
  // stops of each pair of bus lines. This is a game assumption, never a rail connector.
  // The relocation penalty accounts for leaving service; movement remains timed and visible.
  if (vehicle.pool === "bus")
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i]!,
          b = lines[j]!;
        let closest:
          | {
              from: string;
              to: string;
              distance: number;
            }
          | undefined;
        for (const from of new Set([...a.stops, ...(a.returnStops ?? [])]))
          for (const to of new Set([...b.stops, ...(b.returnStops ?? [])])) {
            const first = network.stations.find((s) => s.id === from),
              second = network.stations.find((s) => s.id === to);
            if (!first || !second) continue;
            const distance = Math.hypot(first.x - second.x, first.y - second.y);
            if (!closest || distance < closest.distance)
              closest = { from, to, distance };
          }
        if (closest) {
          const seconds =
            travelTime(network, closest.from, closest.to, "bus") +
            CONFIG.busRelocationSeconds;
          add(graph, node(a.id, closest.from), {
            to: node(b.id, closest.to),
            seconds,
            lineId: b.id,
            fromStation: closest.from,
            toStation: closest.to,
          });
          add(graph, node(b.id, closest.to), {
            to: node(a.id, closest.from),
            seconds,
            lineId: a.id,
            fromStation: closest.to,
            toStation: closest.from,
          });
        }
      }
  const from = projectedStop(network, state, vehicle),
    start = node(vehicle.lineId, from),
    result = search(graph, start);
  const target = lines.find((l) => l.id === targetLineId);
  if (!target) return;
  let end: string | undefined,
    best = Infinity;
  for (const stop of new Set([
    ...target.stops,
    ...(target.returnStops ?? []),
  ])) {
    const key = node(target.id, stop),
      cost = result.dist.get(key) ?? Infinity;
    if (cost < best) {
      best = cost;
      end = key;
    }
  }
  if (!end) return;
  const edges = reconstruct(result.prev, start, end);
  if (!edges) return;
  return [
    { stationId: from, lineId: vehicle.lineId, seconds: 0 },
    ...edges.map((e) => ({
      stationId: e.toStation,
      lineId: e.lineId,
      seconds: e.seconds,
    })),
  ];
}
