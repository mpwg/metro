export type Mode = "metro" | "tram" | "bus";
export type Pool = "metro" | "u6" | "tram" | "bus";
export interface Station {
  id: string;
  name: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
}
export interface TransitLine {
  id: string;
  name: string;
  mode: Mode;
  pool: Pool;
  color: string;
  stops: string[];
  returnStops?: string[];
  headway: number;
  capacity: number;
}
export interface TrackConnector {
  stationId: string;
  toStationId?: string;
  fromLineId: string;
  toLineId: string;
  seconds: number;
  fictional: boolean;
}
export interface WalkingTransfer {
  from: string;
  to: string;
  seconds: number;
}
export interface TransitNetwork {
  version: string;
  sources: { title: string; url: string; retrieved: string; license: string }[];
  stations: Station[];
  lines: TransitLine[];
  connectors: TrackConnector[];
  transfers: WalkingTransfer[];
}
export interface PassengerLeg {
  lineId: string;
  boardStopId: string;
  alightStopId: string;
  direction?: 1 | -1;
}
export interface PassengerGroup {
  originId: string;
  destinationId: string;
  count: number;
  createdAt: number;
  waitSince: number;
  itinerary: PassengerLeg[];
  legIndex: number;
  readyAt?: number;
}
export type VehicleStatus =
  | "service"
  | "deploying"
  | "withdrawing"
  | "transfer"
  | "broken"
  | "reserve";
export interface PathStep {
  stationId: string;
  lineId: string;
  seconds: number;
}
export interface Vehicle {
  id: string;
  lineId: string;
  pool: Pool;
  direction: 1 | -1;
  stopIndex: number;
  progress: number;
  travelSeconds: number;
  dwellRemaining: number;
  status: VehicleStatus;
  passengers: PassengerGroup[];
  holdUntil: number;
  repairUntil: number;
  pendingHoldSeconds?: number;
  assignment?: { lineId: string; terminusId?: string };
  deadheadPath?: PathStep[];
  deadheadIndex?: number;
  shortTurnId?: string;
}
export type EventType = "crowd" | "breakdown" | "closure";
export interface GameEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  stationId: string;
  lineId: string;
  toStationId?: string;
  vehicleId?: string;
  resolved: boolean;
  replacementLineId?: string;
}
export interface Metrics {
  generated: number;
  completed: number;
  abandoned: number;
  totalWaitSeconds: number;
  boarded: number;
}
export interface GameState {
  schemaVersion: 1;
  networkVersion: string;
  seed: number;
  randomState: number;
  time: number;
  vehicles: Vehicle[];
  waiting: Record<string, PassengerGroup[]>;
  events: GameEvent[];
  metrics: Metrics;
  nextVehicleId: number;
  nextEventId: number;
  nextRandomEventAt: number;
  replacementLines: TransitLine[];
}
export type GameCommand =
  | { type: "deploy"; lineId: string }
  | { type: "withdraw"; vehicleId: string }
  | { type: "hold"; vehicleId: string; seconds: number }
  | { type: "shortTurn"; vehicleId: string; stationId: string }
  | { type: "transfer"; vehicleId: string; targetLineId: string }
  | {
      type: "triggerEvent";
      eventType: EventType;
      stationId?: string;
      lineId?: string;
    }
  | { type: "createReplacement"; eventId: string };
export interface CommandResult {
  ok: boolean;
  message: string;
  path?: PathStep[];
}
export interface SavedGame {
  format: "metro-save";
  version: 1;
  savedAt: string;
  state: GameState;
}
export type WorkerRequest =
  | { type: "init"; network: TransitNetwork; state?: GameState; seed?: number }
  | {
      type: "command";
      command: GameCommand;
      preview?: boolean;
      requestId: number;
    }
  | { type: "pause"; paused: boolean }
  | { type: "speed"; speed: 1 | 2 | 5 }
  | { type: "save"; requestId: number };
export type WorkerResponse =
  | { type: "snapshot"; state: GameState; paused: boolean; speed: 1 | 2 | 5 }
  | { type: "result"; result: CommandResult; requestId: number }
  | { type: "save"; state: GameState; requestId: number }
  | { type: "error"; message: string };
