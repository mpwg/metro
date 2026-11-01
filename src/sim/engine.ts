import type {
  CommandResult,
  GameCommand,
  GameEvent,
  GameState,
  PassengerGroup,
  PathStep,
  Pool,
  TransitLine,
  TransitNetwork,
  Vehicle,
} from "../shared/types";
import { CONFIG } from "./config";
import {
  allLines,
  closed,
  getServiceStops,
  planJourney,
  invalidateRoutes,
  transferPath,
  travelTime,
} from "./routes";
export { getServiceStops } from "./routes";
export { CONFIG } from "./config";
function random(state: GameState): number {
  let x = state.randomState >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.randomState = x >>> 0;
  return state.randomState / 4294967296;
}
function lineFor(
  network: TransitNetwork,
  state: GameState,
  id: string,
): TransitLine | undefined {
  return allLines(network, state).find((l) => l.id === id);
}
function newVehicle(
  state: GameState,
  line: TransitLine,
  status: Vehicle["status"],
  direction: 1 | -1 = 1,
  stopIndex = 0,
): Vehicle {
  return {
    id: `v${state.nextVehicleId++}`,
    lineId: line.id,
    pool: line.pool,
    direction,
    stopIndex,
    progress: 0,
    travelSeconds: 0,
    dwellRemaining: CONFIG.dwellSeconds,
    status,
    passengers: [],
    holdUntil: 0,
    repairUntil: 0,
  };
}
export function createGame(network: TransitNetwork, seed = 42): GameState {
  const state: GameState = {
    schemaVersion: 1,
    networkVersion: network.version,
    seed,
    randomState: seed >>> 0 || 0x6d2b79f5,
    time: CONFIG.startTime,
    vehicles: [],
    waiting: Object.fromEntries(network.stations.map((s) => [s.id, []])),
    events: [],
    metrics: {
      generated: 0,
      completed: 0,
      abandoned: 0,
      totalWaitSeconds: 0,
      boarded: 0,
    },
    nextVehicleId: 1,
    nextEventId: 1,
    nextRandomEventAt: CONFIG.startTime + CONFIG.randomEventMinSeconds,
    replacementLines: [],
  };
  const counts = new Map<Pool, number>();
  for (const line of network.lines) {
    if (line.stops.length < 2) continue;
    const duration = ([1, -1] as const).reduce((sum, dir) => {
      const stops = getServiceStops(line, dir);
      return (
        sum +
        stops
          .slice(1)
          .reduce(
            (n, s, i) =>
              n +
              travelTime(network, stops[i]!, s, line.mode) +
              CONFIG.dwellSeconds,
            0,
          )
      );
    }, 0);
    const perDirection = Math.max(
      1,
      Math.ceil(duration / Math.max(30, line.headway) / 2),
    );
    for (const direction of [1, -1] as const) {
      const stops = getServiceStops(line, direction);
      for (let i = 0; i < perDirection; i++) {
        const v = newVehicle(
          state,
          line,
          "service",
          direction,
          Math.floor((i * (stops.length - 1)) / perDirection),
        );
        v.dwellRemaining = Math.round(
          CONFIG.dwellSeconds + (i * line.headway) / perDirection,
        );
        state.vehicles.push(v);
      }
    }
    counts.set(line.pool, (counts.get(line.pool) ?? 0) + perDirection * 2);
  }
  for (const [pool, count] of counts) {
    const line = network.lines.find((l) => l.pool === pool)!;
    for (
      let i = 0;
      i <
      Math.max(
        CONFIG.minimumReserves,
        Math.ceil(count * CONFIG.reserveFraction),
      );
      i++
    )
      state.vehicles.push(newVehicle(state, line, "reserve"));
  }
  generateDemand(network, state);
  processWaiting(network, state);
  for (const v of state.vehicles)
    if (v.status === "service") board(network, state, v);
  return state;
}
// Minute cohorts bound memory. Their earliest wait is retained, a conservative approximation
// of wait duration within that minute; passenger counts remain exact.
function addQueue(
  state: GameState,
  station: string,
  group: PassengerGroup,
): void {
  if (group.count <= 0) return;
  const queue = state.waiting[station] ?? (state.waiting[station] = []),
    bucket = Math.floor(group.waitSince / CONFIG.cohortSeconds);
  const existing = queue.find(
    (g) =>
      g.originId === group.originId &&
      g.destinationId === group.destinationId &&
      Math.floor(g.waitSince / CONFIG.cohortSeconds) === bucket &&
      (g.readyAt ?? 0) === (group.readyAt ?? 0) &&
      g.legIndex === group.legIndex &&
      JSON.stringify(g.itinerary) === JSON.stringify(group.itinerary),
  );
  if (existing) {
    existing.count += group.count;
    existing.createdAt = Math.min(existing.createdAt, group.createdAt);
    existing.waitSince = Math.min(existing.waitSince, group.waitSince);
  } else queue.push(group);
}
function generateGroup(
  network: TransitNetwork,
  state: GameState,
  origin: string,
  destination: string,
  count: number,
): void {
  if (origin === destination) return;
  state.metrics.generated += count;
  addQueue(state, origin, {
    originId: origin,
    destinationId: destination,
    count,
    createdAt: state.time,
    waitSince: state.time,
    itinerary: planJourney(network, state, origin, destination),
    legIndex: 0,
  });
}
function generateDemand(network: TransitNetwork, state: GameState): void {
  const served = new Set(
    allLines(network, state).flatMap((l) => [
      ...l.stops,
      ...(l.returnStops ?? []),
    ]),
  );
  const stations = network.stations.filter((s) => served.has(s.id));
  const hour = (((state.time / 3600) % 24) + 24) % 24;
  const multiplier =
    hour < 5
      ? CONFIG.nightDemandMultiplier
      : (hour >= 7 && hour < 9) || (hour >= 16 && hour < 19)
        ? CONFIG.peakDemandMultiplier
        : CONFIG.dayDemandMultiplier;
  for (const origin of stations) {
    if (random(state) > Math.min(1, CONFIG.demandProbability * multiplier))
      continue;
    const destination = stations[Math.floor(random(state) * stations.length)]!;
    generateGroup(
      network,
      state,
      origin.id,
      destination.id,
      1 + Math.floor(random(state) * CONFIG.demandMaxGroup),
    );
  }
  for (const event of state.events)
    if (event.type === "crowd" && !event.resolved) {
      const line = lineFor(network, state, event.lineId);
      if (line) {
        const target = line.stops.find((s) => s !== event.stationId)!;
        generateGroup(
          network,
          state,
          event.stationId,
          target,
          CONFIG.crowdPerInterval,
        );
      }
    }
}
function processWaiting(
  network: TransitNetwork,
  state: GameState,
  force = false,
): void {
  // Snapshot keys and queues: a walk arrival never boards before its readyAt timestamp.
  for (const station of Object.keys(state.waiting)) {
    const queue = state.waiting[station]!;
    state.waiting[station] = [];
    for (const g of queue) {
      if (state.time - g.waitSince >= CONFIG.abandonSeconds) {
        state.metrics.abandoned += g.count;
        continue;
      }
      if ((g.readyAt ?? 0) > state.time) {
        addQueue(state, station, g);
        continue;
      }
      if (station === g.destinationId) {
        state.metrics.completed += g.count;
        continue;
      }
      if (
        force ||
        g.readyAt !== undefined ||
        !g.itinerary.length ||
        state.time % CONFIG.demandInterval === 0
      ) {
        g.itinerary = planJourney(network, state, station, g.destinationId);
        g.legIndex = 0;
      }
      g.readyAt = undefined;
      const leg = g.itinerary[0];
      if (leg?.lineId === "@walk") {
        const transfer = network.transfers.find(
          (t) =>
            (t.from === leg.boardStopId && t.to === leg.alightStopId) ||
            (t.to === leg.boardStopId && t.from === leg.alightStopId),
        );
        g.legIndex = 1;
        g.readyAt =
          state.time +
          (transfer?.seconds ?? 60) +
          CONFIG.transferPenaltySeconds;
        addQueue(state, leg.alightStopId, g);
      } else addQueue(state, station, g);
    }
  }
}
function currentStop(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
): string {
  return getServiceStops(lineFor(network, state, v.lineId)!, v.direction)[
    v.stopIndex
  ]!;
}
function unload(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
  all = false,
): void {
  const station = currentStop(network, state, v),
    keep: PassengerGroup[] = [];
  for (const group of v.passengers) {
    const leg = group.itinerary[group.legIndex];
    if (station === group.destinationId) {
      state.metrics.completed += group.count;
      continue;
    }
    const stops = getServiceStops(
        lineFor(network, state, v.lineId)!,
        v.direction,
      ),
      target = leg ? stops.indexOf(leg.alightStopId, v.stopIndex) : -1;
    let routeBlocked = target < 0;
    for (let i = v.stopIndex; i < target; i++)
      if (closed(state, v.lineId, stops[i]!, stops[i + 1]!))
        routeBlocked = true;
    if (all || !leg || leg.alightStopId === station || routeBlocked) {
      group.waitSince = state.time;
      group.readyAt = undefined;
      group.itinerary = planJourney(
        network,
        state,
        station,
        group.destinationId,
      );
      group.legIndex = 0;
      addQueue(state, station, group);
    } else keep.push(group);
  }
  v.passengers = keep;
}
function board(network: TransitNetwork, state: GameState, v: Vehicle): void {
  const line = lineFor(network, state, v.lineId)!;
  const stops = getServiceStops(line, v.direction),
    station = stops[v.stopIndex]!;
  let capacity =
    line.capacity - v.passengers.reduce((sum, g) => sum + g.count, 0);
  if (capacity <= 0) return;
  const queue = state.waiting[station] ?? [],
    remaining: PassengerGroup[] = [];
  for (const group of queue) {
    const leg = group.itinerary[group.legIndex],
      target = leg ? stops.indexOf(leg.alightStopId, v.stopIndex + 1) : -1;
    if (
      capacity <= 0 ||
      (group.readyAt ?? 0) > state.time ||
      !leg ||
      leg.lineId !== line.id ||
      (leg.direction !== undefined && leg.direction !== v.direction) ||
      leg.boardStopId !== station ||
      target < 0 ||
      (v.shortTurnId &&
        stops.indexOf(v.shortTurnId) >= v.stopIndex &&
        target > stops.indexOf(v.shortTurnId))
    ) {
      remaining.push(group);
      continue;
    }
    // Do not board somebody onto a known blocked segment even if old itinerary survived one tick.
    let blocked = false;
    for (let i = v.stopIndex; i < target; i++)
      if (closed(state, line.id, stops[i]!, stops[i + 1]!)) blocked = true;
    if (blocked) {
      remaining.push(group);
      continue;
    }
    const count = Math.min(capacity, group.count);
    v.passengers.push({
      ...group,
      count,
      itinerary: group.itinerary.map((l) => ({ ...l })),
    });
    capacity -= count;
    state.metrics.boarded += count;
    state.metrics.totalWaitSeconds += (state.time - group.waitSince) * count;
    if (group.count > count)
      remaining.push({ ...group, count: group.count - count });
  }
  state.waiting[station] = remaining;
}
// Reserves are a shared depot roster. Deployment models depot preparation/positioning
// as a fixed delay; service-to-service relocation always follows a timed physical path.
function deployment(state: GameState, v: Vehicle, line: TransitLine): void {
  v.lineId = line.id;
  v.direction = 1;
  v.stopIndex = 0;
  v.progress = 0;
  v.travelSeconds = 0;
  v.status = "deploying";
  v.dwellRemaining = CONFIG.deploySeconds;
  v.holdUntil = 0;
  delete v.assignment;
  delete v.deadheadPath;
  delete v.deadheadIndex;
  delete v.shortTurnId;
  delete v.pendingHoldSeconds;
}
function withdrawPath(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
): PathStep[] {
  const line = lineFor(network, state, v.lineId)!,
    stops = getServiceStops(line, v.direction),
    index = Math.min(stops.length - 1, v.stopIndex + (v.progress > 0 ? 1 : 0));
  return stops.slice(index).map((s, i) => ({
    stationId: s,
    lineId: line.id,
    seconds: i ? travelTime(network, stops[index + i - 1]!, s, line.mode) : 0,
  }));
}
function beginDeadhead(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
): void {
  unload(network, state, v, true);
  v.progress = 0;
  v.dwellRemaining = CONFIG.dwellSeconds;
  v.deadheadIndex = 0;
}
function finishDeadhead(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
): void {
  const last = v.deadheadPath?.at(-1);
  if (last) {
    v.lineId = last.lineId;
    const line = lineFor(network, state, v.lineId)!;
    let dir: 1 | -1 = 1,
      index = line.stops.indexOf(last.stationId);
    if (index < 0 || index === line.stops.length - 1) {
      dir = -1;
      index = getServiceStops(line, -1).indexOf(last.stationId);
    }
    v.direction = dir;
    v.stopIndex = Math.max(0, index);
  }
  v.status = v.status === "withdrawing" ? "reserve" : "service";
  v.progress = 0;
  v.dwellRemaining = CONFIG.dwellSeconds;
  v.travelSeconds = 0;
  v.holdUntil = 0;
  delete v.deadheadPath;
  delete v.deadheadIndex;
  delete v.assignment;
  delete v.shortTurnId;
}
function blockedByVehicle(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
  next: string,
): boolean {
  return state.vehicles.some(
    (other) =>
      other.id !== v.id &&
      other.lineId === v.lineId &&
      other.direction === v.direction &&
      other.status === "broken" &&
      other.progress === 0 &&
      currentStop(network, state, other) === next,
  );
}
function moveVehicle(
  network: TransitNetwork,
  state: GameState,
  v: Vehicle,
): void {
  if (v.status === "reserve") return;
  if (v.status === "broken") {
    if (state.time >= v.repairUntil) {
      v.status = "service";
      v.dwellRemaining = CONFIG.dwellSeconds;
    } else return;
  }
  if (v.status === "deploying") {
    v.dwellRemaining--;
    if (v.dwellRemaining <= 0) {
      v.status = "service";
      v.dwellRemaining = CONFIG.dwellSeconds;
      board(network, state, v);
    }
    return;
  }
  const nonRevenue = v.status === "transfer" || v.status === "withdrawing";
  if (nonRevenue && v.deadheadIndex !== -1) {
    const path = v.deadheadPath ?? [],
      index = v.deadheadIndex ?? 0,
      next = path[index + 1];
    if (!next) {
      finishDeadhead(network, state, v);
      return;
    }
    if (v.progress === 0) {
      if (v.dwellRemaining > 0) {
        v.dwellRemaining--;
        return;
      }
      const at = path[index]!;
      if (
        at.lineId === next.lineId &&
        closed(state, next.lineId, at.stationId, next.stationId)
      )
        return;
      if (blockedByVehicle(network, state, v, next.stationId)) return;
      v.travelSeconds = Math.max(1, next.seconds);
    }
    v.progress += 1 / Math.max(1, v.travelSeconds);
    if (v.progress >= 1 - 1e-9) {
      v.progress = 0;
      v.deadheadIndex = index + 1;
      v.lineId = next.lineId;
      const line = lineFor(network, state, v.lineId)!,
        previous = path[index]!,
        following = path[index + 2];
      for (const direction of [v.direction, v.direction === 1 ? -1 : 1] as (
        | 1
        | -1
      )[]) {
        const stops = getServiceStops(line, direction),
          stopIndex = stops.indexOf(next.stationId);
        if (stopIndex < 0) continue;
        const sameLine = previous.lineId === next.lineId,
          continues = following?.lineId === next.lineId;
        if (sameLine && stops[stopIndex - 1] !== previous.stationId) continue;
        if (
          !sameLine &&
          continues &&
          stops[stopIndex + 1] !== following.stationId
        )
          continue;
        v.direction = direction;
        v.stopIndex = stopIndex;
        break;
      }
      v.dwellRemaining = CONFIG.dwellSeconds;
      if (v.deadheadIndex === path.length - 1)
        finishDeadhead(network, state, v);
    }
    return;
  }
  const line = lineFor(network, state, v.lineId)!;
  let stops = getServiceStops(line, v.direction);
  if (v.progress > 0) {
    v.progress += 1 / Math.max(1, v.travelSeconds);
    if (v.progress < 1 - 1e-9) return;
    v.progress = 0;
    v.stopIndex = Math.min(stops.length - 1, v.stopIndex + 1);
    v.dwellRemaining = CONFIG.dwellSeconds;
    if (v.pendingHoldSeconds !== undefined) {
      v.holdUntil = state.time + v.pendingHoldSeconds;
      delete v.pendingHoldSeconds;
    }
    if (nonRevenue) {
      beginDeadhead(network, state, v);
      return;
    }
    unload(network, state, v);
    if (v.shortTurnId === stops[v.stopIndex]) {
      unload(network, state, v, true);
      reverse(network, state, v);
      delete v.shortTurnId;
      delete v.pendingHoldSeconds;
    }
    board(network, state, v);
    return;
  }
  if (nonRevenue) {
    beginDeadhead(network, state, v);
    return;
  }
  if (v.stopIndex >= stops.length - 1) {
    unload(network, state, v, true);
    reverse(network, state, v);
    stops = getServiceStops(line, v.direction);
  }
  if (v.dwellRemaining > 0) {
    v.dwellRemaining--;
    return;
  }
  if (v.holdUntil > state.time) return;
  const station = stops[v.stopIndex]!,
    next = stops[v.stopIndex + 1];
  if (!next) return;
  if (closed(state, v.lineId, station, next)) {
    unload(network, state, v);
    return;
  }
  if (
    blockedByVehicle(network, state, v, next) ||
    blockedByVehicle(network, state, v, station)
  )
    return;
  board(network, state, v);
  v.travelSeconds = travelTime(network, station, next, line.mode);
  v.progress = 1 / v.travelSeconds;
}
function reverse(network: TransitNetwork, state: GameState, v: Vehicle): void {
  const station = currentStop(network, state, v),
    line = lineFor(network, state, v.lineId)!,
    direction = v.direction === 1 ? -1 : 1,
    index = getServiceStops(line, direction).indexOf(station);
  if (index >= 0) {
    v.direction = direction;
    v.stopIndex = index;
  }
  v.dwellRemaining = CONFIG.dwellSeconds;
}
export function stepGame(
  network: TransitNetwork,
  state: GameState,
  seconds = 1,
): void {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Ungültige Simulationsdauer.");
  for (let tick = 0; tick < Math.floor(seconds); tick++) {
    state.time++;
    for (const event of state.events)
      if (!event.resolved && state.time >= event.endsAt) {
        event.resolved = true;
        if (event.replacementLineId)
          for (const v of state.vehicles)
            if (v.lineId === event.replacementLineId && v.status === "service")
              executeCommand(network, state, {
                type: "withdraw",
                vehicleId: v.id,
              });
      }
    const recent = state.events
      .filter((e) => e.resolved)
      .slice(-CONFIG.recentEventLimit);
    state.events = state.events.filter(
      (e) => !e.resolved || recent.includes(e),
    );
    if (state.time >= state.nextRandomEventAt) {
      if (
        state.events.filter((e) => !e.resolved).length <
        CONFIG.maxActiveRandomEvents
      ) {
        const types = ["crowd", "breakdown", "closure"] as const;
        executeCommand(network, state, {
          type: "triggerEvent",
          eventType: types[Math.floor(random(state) * types.length)]!,
        });
      }
      state.nextRandomEventAt =
        state.time +
        CONFIG.randomEventMinSeconds +
        Math.floor(
          random(state) *
            (CONFIG.randomEventMaxSeconds - CONFIG.randomEventMinSeconds),
        );
    }
    if (state.time % CONFIG.demandInterval === 0)
      generateDemand(network, state);
    processWaiting(network, state);
    for (const replacement of state.replacementLines) {
      if (
        state.events.some(
          (e) => !e.resolved && e.replacementLineId === replacement.id,
        )
      )
        continue;
      for (const v of state.vehicles)
        if (v.lineId === replacement.id && v.status === "service")
          executeCommand(network, state, { type: "withdraw", vehicleId: v.id });
    }
    for (const vehicle of state.vehicles) moveVehicle(network, state, vehicle);
    // Retired corridors must not accumulate forever. Reserve vehicles return to the shared depot roster.
    state.replacementLines = state.replacementLines.filter((line) => {
      if (
        state.events.some(
          (e) => !e.resolved && e.replacementLineId === line.id,
        ) ||
        state.vehicles.some(
          (v) =>
            (v.lineId === line.id && v.status !== "reserve") ||
            v.assignment?.lineId === line.id ||
            // A line can be a future intermediate leg while the vehicle is still
            // elsewhere. Keep every remaining accepted path reference alive.
            v.deadheadPath
              ?.slice(Math.max(0, v.deadheadIndex ?? 0))
              .some((step) => step.lineId === line.id),
        )
      )
        return true;
      const base = network.lines.find((l) => l.pool === "bus");
      if (!base) return true;
      for (const v of state.vehicles)
        if (v.lineId === line.id) {
          v.lineId = base.id;
          v.direction = 1;
          v.stopIndex = 0;
        }
      invalidateRoutes(state);
      return false;
    });
  }
}
interface EventTarget {
  line: TransitLine;
  station: string;
  to?: string;
  vehicle?: Vehicle;
}
function eventTarget(
  network: TransitNetwork,
  state: GameState,
  command: Extract<
    GameCommand,
    {
      type: "triggerEvent";
    }
  >,
): EventTarget | undefined {
  const lines = allLines(network, state).filter(
    (l) =>
      (!command.lineId || l.id === command.lineId) &&
      (!command.stationId ||
        l.stops.includes(command.stationId) ||
        (l.returnStops ?? []).includes(command.stationId)),
  );
  if (command.eventType === "breakdown") {
    const candidates = state.vehicles.filter(
      (v) =>
        v.status === "service" &&
        v.progress === 0 &&
        lines.some((l) => l.id === v.lineId) &&
        (!command.stationId ||
          currentStop(network, state, v) === command.stationId),
    );
    const vehicle =
      candidates[state.randomState % Math.max(1, candidates.length)];
    if (!vehicle) return;
    return {
      line: lineFor(network, state, vehicle.lineId)!,
      station: currentStop(network, state, vehicle),
      vehicle,
    };
  }
  const line = lines[state.randomState % Math.max(1, lines.length)];
  if (!line) return;
  const station =
      command.stationId ?? line.stops[state.randomState % line.stops.length]!,
    pattern = [getServiceStops(line, 1), getServiceStops(line, -1)].find(
      (stops) => stops.includes(station),
    )!,
    i = pattern.indexOf(station);
  const to = pattern[i + 1] ?? pattern[i - 1];
  if (
    command.eventType === "closure" &&
    (!to || closed(state, line.id, station, to))
  )
    return;
  return { line, station, to };
}
const yes = (message: string, path?: PathStep[]): CommandResult => ({
  ok: true,
  message,
  ...(path ? { path } : {}),
});
const no = (message: string): CommandResult => ({ ok: false, message });
export function previewCommand(
  network: TransitNetwork,
  state: GameState,
  command: GameCommand,
): CommandResult {
  if (command.type === "deploy") {
    const line = lineFor(network, state, command.lineId);
    if (!line) return no("Linie nicht gefunden.");
    return state.vehicles.some(
      (v) => v.pool === line.pool && v.status === "reserve",
    )
      ? yes(`Reserve wird in ${CONFIG.deploySeconds} Sekunden eingesetzt.`)
      : no("Keine passende Reserve verfügbar.");
  }
  if (command.type === "triggerEvent")
    return eventTarget(network, state, command)
      ? yes("Ereignis auslösen.")
      : no("Kein passendes Ereignisziel verfügbar.");
  if (command.type === "createReplacement") {
    const event = state.events.find(
      (e) => e.id === command.eventId && !e.resolved && e.type === "closure",
    );
    if (!event || !event.toStationId) return no("Keine aktive Streckensperre.");
    if (event.replacementLineId) return no("Ersatzverkehr existiert bereits.");
    return state.vehicles.some(
      (v) => v.pool === "bus" && v.status === "reserve",
    )
      ? yes("Oberflächenkorridor mit einem Ersatzbus einrichten.")
      : no("Keine Busreserve verfügbar.");
  }
  const v = state.vehicles.find((v) => v.id === command.vehicleId);
  if (!v) return no("Fahrzeug nicht gefunden.");
  if (v.status !== "service")
    return no("Nur Fahrzeuge im Regelbetrieb können diesen Auftrag annehmen.");
  if (command.type === "withdraw")
    return yes(
      "Fahrgäste steigen am nächsten Halt aus; Betriebsfahrt zum Endpunkt.",
      withdrawPath(network, state, v),
    );
  if (command.type === "hold")
    return Number.isFinite(command.seconds) &&
      command.seconds > 0 &&
      command.seconds <= 600
      ? yes(`Fahrzeug ${Math.round(command.seconds)} Sekunden zurückhalten.`)
      : no("Haltezeit muss zwischen 1 und 600 Sekunden liegen.");
  if (command.type === "shortTurn") {
    const line = lineFor(network, state, v.lineId)!,
      stops = getServiceStops(line, v.direction),
      index = stops.indexOf(command.stationId),
      back = getServiceStops(line, v.direction === 1 ? -1 : 1);
    return index > v.stopIndex &&
      index < stops.length - 1 &&
      back.includes(command.stationId)
      ? yes("Kurzführung am gewählten Halt.")
      : no(
          "Kurzführung benötigt einen erreichbaren Halt mit Rückfahrweg vor dem Endpunkt.",
        );
  }
  const target = lineFor(network, state, command.targetLineId);
  if (!target) return no("Ziellinie nicht gefunden.");
  if (target.id === v.lineId)
    return no("Fahrzeug fährt bereits auf dieser Linie.");
  if (target.pool !== v.pool)
    return no("Inkompatibler Fahrzeugpool; U6 ist isoliert.");
  const path = transferPath(network, state, v, target.id);
  return path
    ? yes("Geprüfte Betriebsfahrt über Verbindungsgleise.", path)
    : no("Kein freier Fahrweg über explizite Verbindungsgleise vorhanden.");
}
export function executeCommand(
  network: TransitNetwork,
  state: GameState,
  command: GameCommand,
): CommandResult {
  // Always revalidate: closures/reserve availability can change since a UI preview.
  const result = previewCommand(network, state, command);
  if (!result.ok) return result;
  invalidateRoutes(state);
  if (command.type === "deploy") {
    const line = lineFor(network, state, command.lineId)!;
    deployment(
      state,
      state.vehicles.find(
        (v) => v.status === "reserve" && v.pool === line.pool,
      )!,
      line,
    );
    return result;
  }
  if (command.type === "triggerEvent") {
    const target = eventTarget(network, state, command)!,
      type = command.eventType,
      duration =
        type === "breakdown"
          ? CONFIG.repairSeconds
          : type === "closure"
            ? CONFIG.closureSeconds
            : CONFIG.crowdSeconds;
    const event: GameEvent = {
      id: `e${state.nextEventId++}`,
      type,
      title:
        type === "crowd"
          ? "Fahrgastandrang"
          : type === "closure"
            ? "Streckensperre"
            : "Fahrzeugdefekt",
      description:
        type === "closure"
          ? "Abschnitt gesperrt. Bereits eingefahrene Fahrzeuge erreichen den nächsten Halt."
          : type === "breakdown"
            ? "Fahrzeug blockiert den Halt bis zur automatischen Reparatur."
            : "Zusätzliche Fahrgäste benötigen Kapazität.",
      startsAt: state.time,
      endsAt: state.time + duration,
      stationId: target.station,
      lineId: target.line.id,
      toStationId: type === "closure" ? target.to : undefined,
      vehicleId: target.vehicle?.id,
      resolved: false,
    };
    state.events.push(event);
    if (target.vehicle) {
      target.vehicle.status = "broken";
      target.vehicle.repairUntil = event.endsAt;
    }
    if (type === "crowd") {
      const destination = target.line.stops.find((s) => s !== target.station)!;
      generateGroup(
        network,
        state,
        target.station,
        destination,
        CONFIG.crowdInitial,
      );
    }
    processWaiting(network, state, true);
    return result;
  }
  if (command.type === "createReplacement") {
    const event = state.events.find((e) => e.id === command.eventId)!,
      id = `SEV-${event.id}`;
    // A clearly simplified aboveground corridor, independent of the closed rail edge.
    const line: TransitLine = {
      id,
      name: `SEV ${event.lineId}`,
      mode: "bus",
      pool: "bus",
      color: "#f7b32b",
      stops: [event.stationId, event.toStationId!],
      headway: 120,
      capacity: 65,
    };
    state.replacementLines.push(line);
    event.replacementLineId = id;
    deployment(
      state,
      state.vehicles.find((v) => v.pool === "bus" && v.status === "reserve")!,
      line,
    );
    return result;
  }
  const v = state.vehicles.find((v) => v.id === command.vehicleId)!;
  if (command.type === "hold") {
    if (v.progress > 0) v.pendingHoldSeconds = Math.round(command.seconds);
    else v.holdUntil = state.time + Math.round(command.seconds);
    return result;
  }
  if (command.type === "shortTurn") {
    v.shortTurnId = command.stationId;
    return result;
  }
  v.status = command.type === "withdraw" ? "withdrawing" : "transfer";
  v.deadheadPath = result.path;
  v.deadheadIndex = v.progress > 0 ? -1 : 0;
  v.assignment =
    command.type === "transfer" ? { lineId: command.targetLineId } : undefined;
  if (v.progress === 0) beginDeadhead(network, state, v);
  return result;
}
