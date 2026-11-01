import type {
  TransitNetwork,
  GameState,
  PassengerGroup,
} from "../src/shared/types";
export const fixture: TransitNetwork = {
  version: "fixture-1",
  sources: [],
  stations: ["a", "b", "c", "d", "e", "f", "g", "h", "z"].map((id, i) => ({
    id,
    name: id,
    x: i * 2,
    y: 0,
  })),
  lines: [
    {
      id: "A",
      name: "A",
      mode: "metro",
      pool: "metro",
      color: "#f00",
      stops: ["a", "b", "c"],
      headway: 60,
      capacity: 30,
    },
    {
      id: "B",
      name: "B",
      mode: "metro",
      pool: "metro",
      color: "#00f",
      stops: ["c", "d", "e"],
      headway: 60,
      capacity: 30,
    },
    {
      id: "C",
      name: "C",
      mode: "metro",
      pool: "metro",
      color: "#0f0",
      stops: ["b", "f"],
      headway: 120,
      capacity: 30,
    },
    {
      id: "U6",
      name: "U6",
      mode: "metro",
      pool: "u6",
      color: "#a60",
      stops: ["c", "g"],
      headway: 120,
      capacity: 30,
    },
    {
      id: "bus",
      name: "bus",
      mode: "bus",
      pool: "bus",
      color: "#aaa",
      stops: ["a", "d", "h"],
      returnStops: ["h", "e", "a"],
      headway: 90,
      capacity: 12,
    },
  ],
  connectors: [
    {
      stationId: "c",
      fromLineId: "A",
      toLineId: "B",
      seconds: 20,
      fictional: true,
    },
  ],
  transfers: [{ from: "e", to: "f", seconds: 45 }],
};
export function quiet(state: GameState) {
  state.nextRandomEventAt = 1e9;
}
export function total(state: GameState) {
  return (
    state.metrics.completed +
    state.metrics.abandoned +
    Object.values(state.waiting)
      .flat()
      .reduce((s, g) => s + g.count, 0) +
    state.vehicles.reduce(
      (s, v) => s + v.passengers.reduce((n, g) => n + g.count, 0),
      0,
    )
  );
}
export function passenger(
  state: GameState,
  originId: string,
  destinationId: string,
  count: number,
): PassengerGroup {
  const group = {
    originId,
    destinationId,
    count,
    createdAt: state.time,
    waitSince: state.time,
    itinerary: [],
    legIndex: 0,
  };
  state.waiting[originId] ??= [];
  state.waiting[originId].push(group);
  state.metrics.generated += count;
  return group;
}
