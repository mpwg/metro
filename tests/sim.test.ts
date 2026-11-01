import { describe, test, expect } from "bun:test";
import {
  createGame,
  stepGame,
  executeCommand,
  previewCommand,
  getServiceStops,
  CONFIG,
} from "../src/sim";
import { fixture, quiet, total, passenger } from "./fixtures";
describe("deterministic service simulation", () => {
  test("starts populated, keeps finite fleet and passenger conservation, resumes serialized seed exactly", () => {
    const a = createGame(fixture, 123);
    const b = createGame(fixture, 123);
    expect(
      a.vehicles.filter((v) => v.status === "service").length,
    ).toBeGreaterThan(5);
    for (const pool of ["metro", "u6", "bus"])
      expect(
        a.vehicles.filter((v) => v.pool === pool && v.status === "reserve")
          .length,
      ).toBeGreaterThanOrEqual(2);
    const fleet = a.vehicles.length;
    stepGame(fixture, a, 600);
    stepGame(fixture, b, 600);
    expect(a).toEqual(b);
    expect(a.metrics.generated).toBeGreaterThan(0);
    expect(total(a)).toBe(a.metrics.generated);
    const loaded = JSON.parse(JSON.stringify(a));
    stepGame(fixture, a, 300);
    stepGame(fixture, loaded, 300);
    expect(loaded).toEqual(a);
    expect(a.vehicles).toHaveLength(fleet);
    expect(total(a)).toBe(a.metrics.generated);
  });
  test("reserve deployment takes time and consumes a finite reserve", () => {
    const s = createGame(fixture);
    quiet(s);
    const n = s.vehicles.filter(
      (v) => v.status === "reserve" && v.pool === "metro",
    ).length;
    expect(executeCommand(fixture, s, { type: "deploy", lineId: "A" }).ok).toBe(
      true,
    );
    const vehicle = s.vehicles.find((v) => v.status === "deploying")!;
    expect(vehicle).toBeDefined();
    stepGame(fixture, s, CONFIG.deploySeconds - 1);
    expect(vehicle.status).toBe("deploying");
    stepGame(fixture, s, 1);
    expect(vehicle.status).toBe("service");
    for (let i = 1; i < n; i++)
      expect(
        executeCommand(fixture, s, { type: "deploy", lineId: "A" }).ok,
      ).toBe(true);
    expect(executeCommand(fixture, s, { type: "deploy", lineId: "A" }).ok).toBe(
      false,
    );
  });
  test("transfer preview is pure and rail switching requires explicit connector, including common stops", () => {
    const s = createGame(fixture);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.status === "service",
    )!;
    const before = JSON.stringify(s);
    const p = previewCommand(fixture, s, {
      type: "transfer",
      vehicleId: v.id,
      targetLineId: "B",
    });
    expect(p.ok).toBe(true);
    expect(p.path?.some((p) => p.lineId === "B")).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
    expect(
      executeCommand(fixture, s, {
        type: "transfer",
        vehicleId: v.id,
        targetLineId: "C",
      }).ok,
    ).toBe(false);
    expect(
      executeCommand(fixture, s, {
        type: "transfer",
        vehicleId: v.id,
        targetLineId: "U6",
      }).ok,
    ).toBe(false);
    expect(
      executeCommand(fixture, s, {
        type: "transfer",
        vehicleId: v.id,
        targetLineId: "B",
      }).ok,
    ).toBe(true);
    stepGame(fixture, s, 1200);
    expect(v.lineId).toBe("B");
    expect(v.status).toBe("service");
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("withdrawal on a moving vehicle unloads at next stop and returns physically to a terminus", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.direction === 1 && v.status === "service",
    )!;
    v.stopIndex = 0;
    v.progress = 0.4;
    v.travelSeconds = 100;
    v.dwellRemaining = 0;
    s.waiting.a.push(...v.passengers);
    v.passengers = [];
    const g = passenger(s, "a", "c", 7);
    s.waiting.a.splice(s.waiting.a.indexOf(g), 1);
    v.passengers = [g];
    expect(
      executeCommand(fixture, s, { type: "withdraw", vehicleId: v.id }).ok,
    ).toBe(true);
    stepGame(fixture, s, 1);
    expect(v.passengers.reduce((n, g) => n + g.count, 0)).toBe(7);
    expect(v.status).toBe("withdrawing");
    stepGame(fixture, s, 61);
    expect(v.passengers).toHaveLength(0);
    expect(v.status).toBe("withdrawing");
    stepGame(fixture, s, 600);
    expect(v.status).toBe("reserve");
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("breakdowns only select stopped service, preserve fleet and repair automatically", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.status === "service",
    )!;
    v.progress = 0;
    v.stopIndex = 1;
    v.dwellRemaining = 10;
    expect(
      executeCommand(fixture, s, {
        type: "triggerEvent",
        eventType: "breakdown",
        lineId: "A",
        stationId: "b",
      }).ok,
    ).toBe(true);
    expect(v.status).toBe("broken");
    const count = s.vehicles.length;
    expect(
      executeCommand(fixture, s, { type: "withdraw", vehicleId: v.id }).ok,
    ).toBe(false);
    stepGame(fixture, s, CONFIG.repairSeconds);
    expect(v.status).toBe("service");
    expect(s.vehicles).toHaveLength(count);
    expect(s.events.find((e) => e.vehicleId === v.id)?.resolved).toBe(true);
  });
  test("closure lets entered vehicles finish but prevents new entry", () => {
    const s = createGame(fixture);
    quiet(s);
    const vs = s.vehicles.filter(
      (v) => v.lineId === "A" && v.status === "service",
    );
    const entered = vs[0]!;
    entered.direction = 1;
    entered.stopIndex = 0;
    entered.progress = 0.5;
    entered.travelSeconds = 20;
    entered.dwellRemaining = 0;
    const stopped = vs[1]!;
    stopped.direction = 1;
    stopped.stopIndex = 0;
    stopped.progress = 0;
    stopped.dwellRemaining = 0;
    expect(
      executeCommand(fixture, s, {
        type: "triggerEvent",
        eventType: "closure",
        lineId: "A",
        stationId: "a",
      }).ok,
    ).toBe(true);
    stepGame(fixture, s, 11);
    expect(entered.stopIndex).toBe(1);
    expect(stopped.stopIndex).toBe(0);
    expect(stopped.progress).toBe(0);
  });
  test("holds stop departure, validates short turn and reverses at its defined stop", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.direction === 1 && v.status === "service",
    )!;
    v.stopIndex = 0;
    v.progress = 0;
    v.dwellRemaining = 0;
    expect(
      executeCommand(fixture, s, { type: "hold", vehicleId: v.id, seconds: 30 })
        .ok,
    ).toBe(true);
    expect(
      executeCommand(fixture, s, {
        type: "shortTurn",
        vehicleId: v.id,
        stationId: "z",
      }).ok,
    ).toBe(false);
    expect(
      executeCommand(fixture, s, {
        type: "shortTurn",
        vehicleId: v.id,
        stationId: "b",
      }).ok,
    ).toBe(true);
    stepGame(fixture, s, 29);
    expect(v.stopIndex).toBe(0);
    expect(v.progress).toBe(0);
    stepGame(fixture, s, 250);
    expect(v.direction).toBe(-1);
    expect(v.shortTurnId).toBeUndefined();
  });
  test("asymmetric bus return follows its actual return stop order", () => {
    expect(getServiceStops(fixture.lines[4]!, -1)).toEqual(["h", "e", "a"]);
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "bus" && v.direction === -1 && v.status === "service",
    )!;
    v.stopIndex = 0;
    v.progress = 0.99;
    v.travelSeconds = 10;
    v.dwellRemaining = 0;
    stepGame(fixture, s, 1);
    expect(v.stopIndex).toBe(1);
    expect(getServiceStops(fixture.lines[4]!, v.direction)[v.stopIndex]).toBe(
      "e",
    );
  });
  test("unserved destinations wait, then abandon after 30 minutes without disappearing", () => {
    const s = createGame(fixture);
    quiet(s);
    passenger(s, "a", "z", 19);
    stepGame(fixture, s, 1801);
    expect(s.waiting.a.some((g) => g.destinationId === "z")).toBe(false);
    expect(s.metrics.abandoned).toBeGreaterThanOrEqual(19);
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("crowd creates targeted demand and deployed relief boards more passengers", () => {
    const base = createGame(fixture);
    quiet(base);
    expect(
      executeCommand(fixture, base, {
        type: "triggerEvent",
        eventType: "crowd",
        lineId: "A",
        stationId: "a",
      }).ok,
    ).toBe(true);
    const relief = structuredClone(base);
    expect(
      executeCommand(fixture, relief, { type: "deploy", lineId: "A" }).ok,
    ).toBe(true);
    stepGame(fixture, base, 600);
    stepGame(fixture, relief, 600);
    expect(relief.metrics.boarded).toBeGreaterThan(base.metrics.boarded);
    expect(total(relief)).toBe(relief.metrics.generated);
  });
  test("replacement serves closure endpoints using the bus pool and restores reachable journeys", () => {
    const s = createGame(fixture);
    quiet(s);
    executeCommand(fixture, s, {
      type: "triggerEvent",
      eventType: "closure",
      lineId: "A",
      stationId: "a",
    });
    const e = s.events.find((e) => e.type === "closure")!;
    expect(
      executeCommand(fixture, s, { type: "createReplacement", eventId: e.id })
        .ok,
    ).toBe(true);
    const line = s.replacementLines[0]!;
    expect(line.pool).toBe("bus");
    expect(line.stops[0]).toBe(e.stationId);
    expect(line.stops.at(-1)).toBe(e.toStationId);
    expect(
      s.vehicles.some((v) => v.lineId === line.id && v.status === "deploying"),
    ).toBe(true);
    const without = structuredClone(s);
    for (const v of without.vehicles.filter((v) => v.lineId === line.id))
      v.status = "reserve";
    without.replacementLines = [];
    passenger(s, "a", "b", 15);
    passenger(without, "a", "b", 15);
    stepGame(fixture, s, 600);
    stepGame(fixture, without, 600);
    expect(s.metrics.completed).toBeGreaterThan(without.metrics.completed);
    expect(total(s)).toBe(s.metrics.generated);
  });
});
describe("disruption boundary regressions", () => {
  test("a stopped breakdown blocks following vehicles departing the same platform", () => {
    const s = createGame(fixture);
    quiet(s);
    const vs = s.vehicles.filter(
      (v) => v.lineId === "A" && v.status === "service" && v.direction === 1,
    );
    const lead = vs[0]!,
      following = vs[1]!;
    for (const v of [lead, following]) {
      v.stopIndex = 0;
      v.progress = 0;
      v.dwellRemaining = 0;
    }
    lead.status = "broken";
    lead.repairUntil = s.time + 240;
    stepGame(fixture, s, 20);
    expect(following.progress).toBe(0);
    expect(following.stopIndex).toBe(0);
  });
  test("onboard passengers replan at a stop when the remaining leg becomes closed", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.status === "service" && v.direction === 1,
    )!;
    s.waiting.a.push(...v.passengers);
    v.passengers = [];
    v.stopIndex = 0;
    v.progress = 0.5;
    v.travelSeconds = 20;
    v.dwellRemaining = 0;
    const g = passenger(s, "a", "c", 5);
    s.waiting.a.splice(s.waiting.a.indexOf(g), 1);
    g.itinerary = [{ lineId: "A", boardStopId: "a", alightStopId: "c" }];
    v.passengers.push(g);
    executeCommand(fixture, s, {
      type: "triggerEvent",
      eventType: "closure",
      lineId: "A",
      stationId: "b",
    });
    stepGame(fixture, s, 10);
    expect(v.stopIndex).toBe(1);
    expect(v.passengers.some((p) => p === g)).toBe(false);
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("a closure introduced after preview invalidates the former transfer route", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.status === "service",
    )!;
    v.stopIndex = 0;
    v.progress = 0;
    expect(
      previewCommand(fixture, s, {
        type: "transfer",
        vehicleId: v.id,
        targetLineId: "B",
      }).ok,
    ).toBe(true);
    executeCommand(fixture, s, {
      type: "triggerEvent",
      eventType: "closure",
      lineId: "A",
      stationId: "a",
    });
    expect(
      executeCommand(fixture, s, {
        type: "transfer",
        vehicleId: v.id,
        targetLineId: "B",
      }).ok,
    ).toBe(false);
    expect(v.status).toBe("service");
  });
  test("walking transfers take time and only complete at the actual destination", () => {
    const s = createGame(fixture);
    quiet(s);
    const g = passenger(s, "e", "f", 11);
    const completed = s.metrics.completed;
    stepGame(fixture, s, 1);
    expect(s.waiting.f.some((p) => p.originId === "e" && p.count === 11)).toBe(
      true,
    );
    expect(s.metrics.completed).toBe(completed);
    stepGame(fixture, s, 80);
    expect(s.waiting.f.some((p) => p === g)).toBe(true);
    stepGame(fixture, s, 10);
    expect(s.waiting.f.some((p) => p === g)).toBe(false);
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("transfer passengers remain aboard until the next physical stop, then rejoin queues", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.status === "service" && v.direction === 1,
    )!;
    s.waiting.a.push(...v.passengers);
    v.passengers = [];
    v.stopIndex = 0;
    v.progress = 0.5;
    v.travelSeconds = 20;
    v.dwellRemaining = 0;
    const g = passenger(s, "a", "c", 3);
    s.waiting.a.splice(s.waiting.a.indexOf(g), 1);
    v.passengers = [g];
    expect(
      executeCommand(fixture, s, {
        type: "transfer",
        vehicleId: v.id,
        targetLineId: "B",
      }).ok,
    ).toBe(true);
    stepGame(fixture, s, 1);
    expect(v.passengers).toHaveLength(1);
    stepGame(fixture, s, 9);
    expect(v.passengers).toHaveLength(0);
    expect(v.lineId).toBe("A");
    expect(total(s)).toBe(s.metrics.generated);
  });
});
describe("long running bookkeeping", () => {
  test("keeps all active events and only the latest sixty resolved events", () => {
    const s = createGame(fixture);
    quiet(s);
    for (let i = 0; i < 70; i++) {
      executeCommand(fixture, s, {
        type: "triggerEvent",
        eventType: "crowd",
        lineId: "A",
        stationId: "a",
      });
      s.events.at(-1)!.endsAt = s.time;
    }
    executeCommand(fixture, s, {
      type: "triggerEvent",
      eventType: "closure",
      lineId: "B",
      stationId: "c",
    });
    stepGame(fixture, s, 1);
    expect(s.events.filter((e) => e.resolved)).toHaveLength(60);
    expect(s.events.some((e) => !e.resolved && e.type === "closure")).toBe(
      true,
    );
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("fixed one-second stepping is identical to the corresponding batch", () => {
    const a = createGame(fixture, 55),
      b = structuredClone(a);
    stepGame(fixture, a, 900);
    for (let i = 0; i < 900; i++) stepGame(fixture, b);
    expect(a).toEqual(b);
    expect(a.events.length).toBeGreaterThan(0);
    expect(
      a.events.every((e) => Number.isFinite(e.endsAt) && e.endsAt > e.startsAt),
    ).toBe(true);
    expect(total(a)).toBe(a.metrics.generated);
  });
});
test("a replacement launched near expiry retires after finishing deployment and returns its bus reserve", () => {
  const s = createGame(fixture);
  quiet(s);
  executeCommand(fixture, s, {
    type: "triggerEvent",
    eventType: "closure",
    lineId: "A",
    stationId: "a",
  });
  const e = s.events.at(-1)!;
  e.endsAt = s.time + 2;
  const reserve = s.vehicles.filter(
    (v) => v.pool === "bus" && v.status === "reserve",
  ).length;
  executeCommand(fixture, s, { type: "createReplacement", eventId: e.id });
  const id = e.replacementLineId!;
  stepGame(fixture, s, CONFIG.deploySeconds + 600);
  expect(
    s.vehicles.filter((v) => v.pool === "bus" && v.status === "reserve"),
  ).toHaveLength(reserve);
  expect(
    s.vehicles.some((v) => v.lineId === id && v.status === "service"),
  ).toBe(false);
  expect(s.replacementLines.some((l) => l.id === id)).toBe(false);
  expect(total(s)).toBe(s.metrics.generated);
});
test("reverse-direction withdrawals retain their physical travel direction between stops", () => {
  const s = createGame(fixture);
  quiet(s);
  const v = s.vehicles.find(
    (v) => v.lineId === "A" && v.direction === -1 && v.status === "service",
  )!;
  v.stopIndex = 0;
  v.progress = 0;
  v.dwellRemaining = 0;
  executeCommand(fixture, s, { type: "withdraw", vehicleId: v.id });
  stepGame(fixture, s, CONFIG.dwellSeconds + CONFIG.minimumTravelSeconds);
  expect(v.status).toBe("withdrawing");
  expect(v.direction).toBe(-1);
  expect(getServiceStops(fixture.lines[0]!, -1)[v.stopIndex]).toBe("b");
});
describe("dispatch integration contracts", () => {
  test("time-of-day demand creates more peak demand than quiet night demand with a fixed seed", () => {
    const day = createGame(fixture, 987),
      night = structuredClone(day);
    quiet(day);
    quiet(night);
    day.time = 7 * 3600;
    night.time = 2 * 3600;
    const initial = day.metrics.generated;
    stepGame(fixture, day, 600);
    stepGame(fixture, night, 600);
    expect(day.metrics.generated - initial).toBeGreaterThan(
      (night.metrics.generated - initial) * 2,
    );
  });
  test("wait metric records elapsed platform wait only when boarding occurs", () => {
    const s = createGame(fixture);
    quiet(s);
    s.time = 100;
    s.waiting = Object.fromEntries(fixture.stations.map((st) => [st.id, []]));
    s.metrics = {
      generated: 0,
      completed: 0,
      abandoned: 0,
      totalWaitSeconds: 0,
      boarded: 0,
    };
    for (const v of s.vehicles) {
      v.status = "reserve";
      v.passengers = [];
    }
    const v = s.vehicles.find((v) => v.lineId === "A")!;
    v.status = "service";
    v.direction = 1;
    v.stopIndex = 0;
    v.progress = 0;
    v.dwellRemaining = 0;
    const group = passenger(s, "a", "b", 5);
    group.waitSince = 0;
    expect(s.metrics.totalWaitSeconds).toBe(0);
    stepGame(fixture, s, 1);
    expect(s.metrics.boarded).toBe(5);
    expect(s.metrics.totalWaitSeconds).toBe(505);
  });
  test("bus line changes follow a timed surface route while rail crossings stay restricted", () => {
    const n = structuredClone(fixture);
    n.lines.push({
      id: "bus2",
      name: "bus2",
      mode: "bus",
      pool: "bus",
      color: "#888",
      stops: ["e", "g"],
      headway: 90,
      capacity: 12,
    });
    const s = createGame(n);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "bus" && v.status === "service",
    )!;
    v.stopIndex = 0;
    v.progress = 0;
    const result = previewCommand(n, s, {
      type: "transfer",
      vehicleId: v.id,
      targetLineId: "bus2",
    });
    expect(result.ok).toBe(true);
    expect(
      result.path!.some((p) => p.lineId === "bus2" && p.seconds >= 90),
    ).toBe(true);
    executeCommand(n, s, {
      type: "transfer",
      vehicleId: v.id,
      targetLineId: "bus2",
    });
    stepGame(n, s, 10);
    expect(v.status).toBe("transfer");
    stepGame(n, s, 700);
    expect(v.lineId).toBe("bus2");
    expect(v.status).toBe("service");
    expect(total(s)).toBe(s.metrics.generated);
  });
  test("hold requested in motion starts its countdown at the next physical stop", () => {
    const s = createGame(fixture);
    quiet(s);
    const v = s.vehicles.find(
      (v) => v.lineId === "A" && v.status === "service",
    )!;
    v.direction = 1;
    v.stopIndex = 0;
    v.progress = 0.1;
    v.travelSeconds = 100;
    v.dwellRemaining = 0;
    executeCommand(fixture, s, { type: "hold", vehicleId: v.id, seconds: 30 });
    stepGame(fixture, s, 90);
    expect(v.stopIndex).toBe(1);
    expect(v.progress).toBe(0);
    stepGame(fixture, s, 29);
    expect(v.stopIndex).toBe(1);
    expect(v.progress).toBe(0);
    stepGame(fixture, s, 1);
    expect(v.progress).toBeGreaterThan(0);
  });
});
