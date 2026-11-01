import { expect, test } from "bun:test";
import type { TransitNetwork } from "../src/shared/types";
import {
  createGame,
  executeCommand,
  getServiceStops,
  stepGame,
} from "../src/sim";
import { planJourney } from "../src/sim/routes";
import { network } from "../src/data/network";
import { passenger, quiet, total } from "./fixtures";

const asymmetric: TransitNetwork = {
  version: "asymmetric-review",
  sources: [],
  stations: ["a", "b", "c", "d", "x"].map((id, i) => ({
    id,
    name: id,
    x: i,
    y: 0,
  })),
  lines: [
    {
      id: "L",
      name: "L",
      mode: "bus",
      pool: "bus",
      color: "#999",
      stops: ["a", "b", "c", "d"],
      returnStops: ["d", "x", "b", "a"],
      headway: 90,
      capacity: 30,
    },
  ],
  connectors: [],
  transfers: [],
};

test("same-line direction changes require separate boardable legs and passengers finish both legs", () => {
  const state = createGame(asymmetric);
  quiet(state);
  expect(planJourney(asymmetric, state, "c", "x")).toEqual([
    { lineId: "L", direction: 1, boardStopId: "c", alightStopId: "d" },
    { lineId: "L", direction: -1, boardStopId: "d", alightStopId: "x" },
  ]);
  state.waiting = Object.fromEntries(
    asymmetric.stations.map((s) => [s.id, []]),
  );
  state.metrics = {
    generated: 0,
    completed: 0,
    abandoned: 0,
    totalWaitSeconds: 0,
    boarded: 0,
  };
  for (const v of state.vehicles) {
    v.passengers = [];
    v.status = "reserve";
  }
  const v = state.vehicles[0]!;
  v.status = "service";
  v.direction = 1;
  v.stopIndex = 2;
  v.progress = 0;
  v.dwellRemaining = 0;
  passenger(state, "c", "x", 7);
  stepGame(asymmetric, state, 1);
  expect(v.passengers.reduce((n, g) => n + g.count, 0)).toBe(7);
  stepGame(asymmetric, state, 180);
  expect(state.metrics.completed).toBeGreaterThanOrEqual(7);
  expect(total(state)).toBe(state.metrics.generated);
});

test("a passenger leg may only board its selected direction on a shared station", () => {
  const state = createGame(asymmetric);
  quiet(state);
  state.waiting = Object.fromEntries(
    asymmetric.stations.map((s) => [s.id, []]),
  );
  state.metrics = {
    generated: 0,
    completed: 0,
    abandoned: 0,
    totalWaitSeconds: 0,
    boarded: 0,
  };
  for (const v of state.vehicles) {
    v.passengers = [];
    v.status = "reserve";
  }
  const v = state.vehicles[0]!;
  v.status = "service";
  v.direction = 1;
  v.stopIndex = 0;
  v.progress = 0;
  v.dwellRemaining = 0;
  const g = passenger(state, "a", "b", 4);
  g.itinerary = [
    { lineId: "L", direction: -1, boardStopId: "a", alightStopId: "b" },
  ];
  stepGame(asymmetric, state, 1);
  expect(v.passengers).toHaveLength(0);
  expect(state.metrics.boarded).toBe(0);
});

test("all real station-pair journeys contain only legs feasible within a single directional pattern", () => {
  const state = createGame(network);
  const invalid: string[] = [];
  for (const origin of network.stations)
    for (const destination of network.stations) {
      for (const leg of planJourney(
        network,
        state,
        origin.id,
        destination.id,
      )) {
        if (leg.lineId === "@walk") continue;
        const line = network.lines.find((l) => l.id === leg.lineId)!;
        const directions =
          leg.direction === undefined ? ([1, -1] as const) : [leg.direction];
        if (
          !directions.some((direction) => {
            const stops = getServiceStops(line, direction);
            const board = stops.indexOf(leg.boardStopId);
            return (
              board >= 0 && stops.indexOf(leg.alightStopId, board + 1) > board
            );
          })
        )
          invalid.push(
            `${origin.id}->${destination.id}: ${leg.lineId} ${leg.boardStopId}->${leg.alightStopId}`,
          );
      }
    }
  expect(invalid.slice(0, 10)).toEqual([]);
  expect(invalid).toHaveLength(0);
});

test("accepted surface transfers retain intermediate replacement lines until their path finishes", () => {
  const state = createGame(network, 42);
  quiet(state);
  const vehicle = state.vehicles.find((v) => v.id === "v191")!;
  expect(vehicle.lineId).toBe("13A");
  executeCommand(network, state, {
    type: "hold",
    vehicleId: vehicle.id,
    seconds: 600,
  });
  expect(
    executeCommand(network, state, {
      type: "triggerEvent",
      eventType: "closure",
      lineId: "U1",
      stationId: "oberlaa",
    }).ok,
  ).toBe(true);
  const event = state.events.find((e) => e.type === "closure")!;
  expect(
    executeCommand(network, state, {
      type: "createReplacement",
      eventId: event.id,
    }).ok,
  ).toBe(true);
  stepGame(network, state, 600);
  const result = executeCommand(network, state, {
    type: "transfer",
    vehicleId: vehicle.id,
    targetLineId: "15A",
  });
  expect(result.ok).toBe(true);
  expect(result.path!.some((p) => p.lineId === event.replacementLineId)).toBe(
    true,
  );
  stepGame(network, state, 310);
  expect(
    state.replacementLines.some((l) => l.id === event.replacementLineId),
  ).toBe(true);
  const second = state.vehicles.find(
    (v) => v.lineId === "13A" && v.status === "service",
  )!;
  const newPath = executeCommand(network, state, {
    type: "transfer",
    vehicleId: second.id,
    targetLineId: "15A",
  });
  expect(newPath.ok).toBe(true);
  expect(newPath.path!.some((p) => p.lineId === event.replacementLineId)).toBe(
    false,
  );
  stepGame(network, state, 2400);
  expect(vehicle.lineId).toBe("15A");
  expect(vehicle.status).toBe("service");
  expect(
    state.replacementLines.some((l) => l.id === event.replacementLineId),
  ).toBe(false);
  expect(total(state)).toBe(state.metrics.generated);
}, 20000);

test("closures can target a stop served exclusively by an asymmetric return pattern", () => {
  const state = createGame(network);
  quiet(state);
  const line = network.lines.find((l) => l.id === "13A")!,
    station = "theater-in-der-josefstadt";
  expect(line.stops.includes(station)).toBe(false);
  expect(line.returnStops!.includes(station)).toBe(true);
  expect(
    executeCommand(network, state, {
      type: "triggerEvent",
      eventType: "closure",
      lineId: line.id,
      stationId: station,
    }).ok,
  ).toBe(true);
  const event = state.events.at(-1)!;
  expect(event.stationId).toBe(station);
  const index = line.returnStops!.indexOf(station);
  expect(event.toStationId).toBe(line.returnStops![index + 1]);
});
