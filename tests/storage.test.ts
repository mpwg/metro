import { expect, test, beforeEach } from "bun:test";
import "fake-indexeddb/auto";
import {
  saveGame,
  loadGame,
  deleteGame,
  validateSave,
} from "../src/persistence/storage";
import type { GameState } from "../src/shared/types";
const state = {
  schemaVersion: 1,
  networkVersion: "fixture",
  time: 25200,
  seed: 42,
  randomState: 42,
  vehicles: [],
  waiting: {},
  events: [],
  replacementLines: [],
  metrics: {
    generated: 0,
    completed: 0,
    abandoned: 0,
    totalWaitSeconds: 0,
    boarded: 0,
  },
  nextVehicleId: 1,
  nextEventId: 1,
  nextRandomEventAt: 26000,
} as GameState;
beforeEach(async () => {
  await deleteGame();
});
test("round trips full deterministic state through IndexedDB", async () => {
  await saveGame(state);
  const loaded = await loadGame("fixture");
  expect(loaded?.state).toEqual(state);
  expect(loaded?.format).toBe("metro-save");
});
test("rejects incompatible network and malformed saves without overwriting the good game", async () => {
  await saveGame(state);
  await expect(loadGame("other-network")).rejects.toThrow("Netzversion");
  expect(() =>
    validateSave({ format: "metro-save", version: 1, state: {} }, "fixture"),
  ).toThrow();
  expect((await loadGame("fixture"))?.state.randomState).toBe(42);
});
test("delete affects only the game slot and missing slot returns null", async () => {
  await saveGame(state);
  await deleteGame();
  expect(await loadGame("fixture")).toBeNull();
});
