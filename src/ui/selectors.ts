import type {
  GameState,
  Station,
  TransitLine,
  TransitNetwork,
  Vehicle,
} from "../shared/types";
export function serviceStops(line: TransitLine, direction: 1 | -1) {
  return direction === 1
    ? line.stops
    : (line.returnStops ?? [...line.stops].reverse());
}
export function allLines(network: TransitNetwork, state?: GameState) {
  return [...network.lines, ...(state?.replacementLines ?? [])];
}
export function vehicleLoad(vehicle: Vehicle) {
  return vehicle.passengers.reduce((sum, group) => sum + group.count, 0);
}
export function waitingAt(state: GameState, stationId: string) {
  return (state.waiting[stationId] ?? []).reduce((sum, g) => sum + g.count, 0);
}
export function positionOf(
  vehicle: Vehicle,
  lines: TransitLine[],
  stations: Map<string, Station>,
) {
  const line = lines.find((l) => l.id === vehicle.lineId);
  if (!line) return { x: 0, y: 0 };
  const stops = serviceStops(line, vehicle.direction);
  const steps = vehicle.deadheadPath;
  const deadhead =
    vehicle.status !== "service" &&
    vehicle.status !== "broken" &&
    steps?.length &&
    (vehicle.deadheadIndex ?? -1) >= 0;
  const i = deadhead ? (vehicle.deadheadIndex ?? 0) : vehicle.stopIndex;
  const a = stations.get(deadhead ? steps![i]?.stationId : stops[i]);
  const b = stations.get(deadhead ? steps![i + 1]?.stationId : stops[i + 1]);
  if (!a) return { x: 0, y: 0 };
  const progress = vehicle.progress;
  return {
    x: a.x + ((b?.x ?? a.x) - a.x) * progress,
    y: a.y + ((b?.y ?? a.y) - a.y) * progress,
  };
}
export const statusLabel = {
  service: "Im Fahrgastbetrieb",
  reserve: "In Reserve",
  deploying: "Rückt aus",
  withdrawing: "Rückt ein",
  transfer: "Betriebsfahrt",
  broken: "Defekt · Reparatur läuft",
};
export function clock(time: number) {
  const t = Math.floor(time) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}`;
}
