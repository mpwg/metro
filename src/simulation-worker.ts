/// <reference lib="webworker" />
import type {
  TransitNetwork,
  GameState,
  WorkerRequest,
  WorkerResponse,
} from "./shared/types";
import {
  createGame,
  stepGame,
  executeCommand,
  previewCommand,
} from "./sim/engine";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let network: TransitNetwork | undefined;
let state: GameState | undefined;
let paused = true;
let speed: 1 | 2 | 5 = 1;
let previous = performance.now();
let accumulated = 0;
function send(message: WorkerResponse) {
  ctx.postMessage(message);
}
function snapshot() {
  if (state) send({ type: "snapshot", state, paused, speed });
}
ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "init") {
      network = message.network;
      state = message.state
        ? structuredClone(message.state)
        : createGame(network, message.seed);
      paused = true;
      accumulated = 0;
      previous = performance.now();
      snapshot();
    } else if (message.type === "pause") {
      paused = message.paused;
      previous = performance.now();
      accumulated = 0;
      snapshot();
    } else if (message.type === "speed") {
      speed = message.speed;
      snapshot();
    } else if (message.type === "save" && state)
      send({ type: "save", state, requestId: message.requestId });
    else if (message.type === "command" && state && network) {
      const result = message.preview
        ? previewCommand(network, state, message.command)
        : executeCommand(network, state, message.command);
      send({ type: "result", result, requestId: message.requestId });
      if (!message.preview) snapshot();
    }
  } catch (error) {
    paused = true;
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min((now - previous) / 1000, 1);
  previous = now;
  if (!state || !network || paused) return;
  accumulated += elapsed * speed;
  try {
    const steps = Math.floor(accumulated);
    if (steps > 0) {
      stepGame(network, state, steps);
      accumulated -= steps;
    }
    snapshot();
  } catch (error) {
    paused = true;
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}, 200);
