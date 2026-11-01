import { expect, test } from "bun:test";
import { network } from "../src/data/network";
import { createGame, stepGame } from "../src/sim";
import { total } from "./fixtures";

test("full eighteen-line network stays conserved and bounded through a half-hour of seeded operation", () => {
  const state = createGame(network, 607);
  const fleet = state.vehicles.length;
  stepGame(network, state, 1800);
  expect(state.metrics.generated).toBeGreaterThan(1000);
  expect(total(state)).toBe(state.metrics.generated);
  expect(state.vehicles).toHaveLength(fleet);
  expect(Object.values(state.waiting).flat().length).toBeLessThan(20000);
  for (const v of state.vehicles) {
    expect(Number.isFinite(v.progress)).toBe(true);
    expect(v.progress).toBeGreaterThanOrEqual(0);
    expect(v.progress).toBeLessThan(1);
    const line = [...network.lines, ...state.replacementLines].find(
      (l) => l.id === v.lineId,
    )!;
    expect(v.passengers.reduce((n, g) => n + g.count, 0)).toBeLessThanOrEqual(
      line.capacity,
    );
  }
  const resumed = JSON.parse(JSON.stringify(state));
  stepGame(network, state, 60);
  stepGame(network, resumed, 60);
  expect(resumed).toEqual(state);
  expect(total(state)).toBe(state.metrics.generated);
  // This checks 30 simulated minutes and state invariants, not runner CPU speed.
}, 30_000);
