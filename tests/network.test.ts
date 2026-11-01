import { describe, expect, test } from "bun:test";
import { network } from "../src/data/network";

describe("pinned Vienna network", () => {
  test("contains the complete requested set and both directions", () => {
    expect(network.lines.map((l) => l.id).sort()).toEqual(
      [
        "U1",
        "U2",
        "U3",
        "U4",
        "U6",
        "D",
        "O",
        "1",
        "2",
        "6",
        "18",
        "31",
        "43",
        "49",
        "13A",
        "14A",
        "15A",
        "48A",
      ].sort(),
    );
    const stations = new Map(network.stations.map((s) => [s.id, s]));
    for (const line of network.lines) {
      expect(line.stops.length).toBeGreaterThan(10);
      expect(line.returnStops!.length).toBeGreaterThan(10);
      expect(line.returnStops![0]).toBe(line.stops.at(-1)!);
      expect(line.returnStops!.at(-1)).toBe(line.stops[0]);
      for (const id of [...line.stops, ...line.returnStops!])
        expect(stations.has(id)).toBe(true);
      expect(line.headway).toBe(
        line.mode === "metro" ? 180 : line.mode === "tram" ? 300 : 420,
      );
      expect(line.capacity).toBe(
        line.id === "U6"
          ? 500
          : line.mode === "metro"
            ? 700
            : line.mode === "tram"
              ? 180
              : 85,
      );
      if (line.mode === "metro")
        expect(line.returnStops).toEqual([...line.stops].reverse());
    }
    expect(new Set(network.stations.map((s) => s.id)).size).toBe(
      network.stations.length,
    );
    for (const station of network.stations) {
      expect(station.name.length).toBeGreaterThan(1);
      expect(station.lat!).toBeGreaterThan(48);
      expect(station.lon!).toBeGreaterThan(16);
      expect(station.x).toBeGreaterThanOrEqual(0);
      expect(station.x).toBeLessThanOrEqual(1600);
      expect(station.y).toBeGreaterThanOrEqual(0);
      expect(station.y).toBeLessThanOrEqual(1300);
    }
  });
  test("uses sourced complete metro patterns and real asymmetric bus patterns", () => {
    for (const [id, count] of [
      ["U1", 24],
      ["U2", 21],
      ["U3", 21],
      ["U4", 20],
      ["U6", 24],
    ] as const) {
      expect(network.lines.find((l) => l.id === id)!.stops).toHaveLength(count);
    }
    const bus = network.lines.find((l) => l.id === "13A")!;
    expect(bus.returnStops).not.toEqual([...bus.stops].reverse());
    expect(network.sources.some((s) => s.url.includes("gtfs.zip"))).toBe(true);
    expect(
      network.sources.every(
        (s) => s.license.includes("CC BY") && !!s.retrieved,
      ),
    ).toBe(true);
  });
  test("only explicit compatible connectors permit vehicle line changes", () => {
    for (const connector of network.connectors) {
      const a = network.lines.find((l) => l.id === connector.fromLineId)!;
      const b = network.lines.find((l) => l.id === connector.toLineId)!;
      expect(a.pool).toBe(b.pool);
      expect(a.pool).not.toBe("u6");
      expect(a.pool).not.toBe("bus");
      expect([...a.stops, ...a.returnStops!]).toContain(connector.stationId);
      expect([...b.stops, ...b.returnStops!]).toContain(
        connector.toStationId ?? connector.stationId,
      );
      expect(connector.fictional).toBe(a.mode === "metro");
    }
    expect(network.connectors.filter((c) => c.fictional)).toHaveLength(4);
    expect(network.transfers.length).toBeGreaterThan(2);
    const stations = new Set(network.stations.map((s) => s.id));
    for (const transfer of network.transfers) {
      expect(stations.has(transfer.from)).toBe(true);
      expect(stations.has(transfer.to)).toBe(true);
      expect(transfer.seconds).toBeGreaterThan(0);
    }
  });
});
