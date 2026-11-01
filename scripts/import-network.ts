/** Rebuild the pinned schematic from official GTFS CSV files, using Bun only. */
import type { TransitNetwork, Station, TransitLine } from "../src/shared/types";

const URL = "https://www.wienerlinien.at/ogd_realtime/doku/ogd/gtfs/gtfs.zip";
const SHA256 =
  "21cf933cf1970edde3cedf1e292bfa04780054361c44dc30295ea31cc4008913";
const retrieved = "2026-11-01";
const selections = [
  ["U1", "21-U1-j26-1"],
  ["U2", "21-U2-j26-3"],
  ["U3", "21-U3-j26-1"],
  ["U4", "21-U4-j26-1"],
  ["U6", "21-U6-j26-2"],
  ["D", "22-D-j26-1"],
  ["O", "22-O-j26-1"],
  ["1", "22-1-j26-1"],
  ["2", "22-2-j26-1"],
  ["6", "22-6-j26-1"],
  ["18", "22-18-j26-11"],
  ["31", "22-31-j26-1"],
  ["43", "22-43-j26-1"],
  ["49", "22-49-j26-1"],
  ["13A", "23-13A-j26-1"],
  ["14A", "23-14A-j26-1"],
  ["15A", "23-15A-j26-1"],
  ["48A", "23-48A-j26-1"],
] as const;
// Full passenger-service terminals exclude depot access and early/late short workings.
const terminals: Record<string, [string, string]> = {
  U1: ["Oberlaa", "Leopoldau"],
  U2: ["Seestadt", "Karlsplatz"],
  U3: ["Ottakring", "Simmering"],
  U4: ["Hütteldorf", "Heiligenstadt"],
  U6: ["Siebenhirten", "Floridsdorf"],
  D: ["Absberggasse", "Nußdorf, Beethovengang"],
  O: ["Raxstraße", "Bruno-Marek-Allee"],
  "1": ["Prater, Hauptallee", "Stefan-Fadinger-Platz"],
  "2": ["Dornbach", "Friedrich-Engels-Platz"],
  "6": ["Burggasse-Stadthalle", "Geiereckstraße"],
  "18": ["Burggasse-Stadthalle", "Stadion"],
  "31": ["Schottenring", "Stammersdorf"],
  "43": ["Schottentor", "Neuwaldegg"],
  "49": ["Parlament/Volkstheater", "Hütteldorf, Bujattigasse"],
  "13A": ["Skodagasse", "Hauptbahnhof"],
  "14A": ["Neubaugasse", "Reumannplatz"],
  "15A": ["Meidling, Schedifkaplatz", "Enkplatz"],
  "48A": ["Parlament/Volkstheater", "Klinik Penzing"],
};

function csv(line: string): string[] {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      result.push(value);
      value = "";
    } else value += c;
  }
  result.push(value);
  return result;
}
async function* rows(path: string): AsyncGenerator<Record<string, string>> {
  const decoder = new TextDecoder();
  let rest = "";
  let headers: string[] | undefined;
  const reader = Bun.file(path).stream().getReader();
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(chunk, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop()!;
    for (const line of lines) {
      const values = csv(line.replace(/\r$/, "").replace(/^\uFEFF/, ""));
      if (!headers) {
        headers = values;
        continue;
      }
      if (line)
        yield Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    }
  }
}
const arg = Bun.argv.indexOf("--zip");
const zip = arg >= 0 ? Bun.argv[arg + 1]! : "/tmp/metro-official-gtfs.zip";
if (!(await Bun.file(zip).exists())) {
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`Download: ${response.status}`);
  await Bun.write(zip, response);
}
const hash = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(zip).arrayBuffer())
  .digest("hex");
if (hash !== SHA256)
  throw new Error(
    `GTFS changed (${hash}). Preserve the pinned snapshot; review route variants and update the pin explicitly.`,
  );
const directory = "/tmp/metro-import-" + SHA256.slice(0, 12);
await Bun.$`mkdir -p ${directory}`.quiet();
await Bun.$`unzip -o -q ${zip} routes.txt trips.txt stops.txt stop_times.txt -d ${directory}`.quiet();
const routeIds = new Set(selections.map((s) => s[1] as string));
const routes = new Map<string, Record<string, string>>();
for await (const row of rows(directory + "/routes.txt"))
  if (routeIds.has(row.route_id!)) routes.set(row.route_id!, row);
// One representative per shape is enough to recover its stop pattern; frequency is retained for tie-breaking.
const shapes = new Map<
  string,
  { trip: string; route: string; direction: string; count: number }
>();
const representatives = new Map<
  string,
  { route: string; direction: string; stops: string[] }
>();
for await (const row of rows(directory + "/trips.txt")) {
  if (!routeIds.has(row.route_id!)) continue;
  const key = row.route_id + "|" + row.direction_id + "|" + row.shape_id;
  const known = shapes.get(key);
  if (known) known.count++;
  else {
    shapes.set(key, {
      trip: row.trip_id!,
      route: row.route_id!,
      direction: row.direction_id!,
      count: 1,
    });
    representatives.set(row.trip_id!, {
      route: row.route_id!,
      direction: row.direction_id!,
      stops: [],
    });
  }
}
const patternCache = directory + "/selected-patterns.json";
if (await Bun.file(patternCache).exists()) {
  const cached = (await Bun.file(patternCache).json()) as Record<
    string,
    string[]
  >;
  for (const [id, pattern] of representatives) pattern.stops = cached[id] ?? [];
} else {
  for await (const row of rows(directory + "/stop_times.txt"))
    representatives.get(row.trip_id!)?.stops.push(row.stop_id!);
  await Bun.write(
    patternCache,
    JSON.stringify(
      Object.fromEntries([...representatives].map(([id, p]) => [id, p.stops])),
    ),
  );
}
const stopRows = new Map<string, Record<string, string>>();
for await (const row of rows(directory + "/stops.txt"))
  stopRows.set(row.stop_id!, row);
// Platform codes are intentionally merged by the passenger-facing physical stop name.
const cleanName = (name: string) => {
  const clean = name
    .replace(/^Wien /, "")
    .replace(/ (S U|U S|U|S)$/, "")
    .trim();
  return clean === "Mitte-Landstraße"
    ? "Landstraße"
    : clean === "Bahnhof Meidling"
      ? "Meidling"
      : clean;
};
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const grouped = new Map<
  string,
  { name: string; lat: number[]; lon: number[]; gtfs: Set<string> }
>();
function stationId(raw: string): string {
  const stop = stopRows.get(raw);
  if (!stop) throw new Error("Missing GTFS stop " + raw);
  const name = cleanName(stop.stop_name!);
  const id = slug(name);
  let station = grouped.get(id);
  if (!station) {
    station = { name, lat: [], lon: [], gtfs: new Set() };
    grouped.set(id, station);
  }
  if (!station.gtfs.has(raw)) {
    station.gtfs.add(raw);
    station.lat.push(+stop.stop_lat!);
    station.lon.push(+stop.stop_lon!);
  }
  return id;
}
const lines: TransitLine[] = [];
const manifest: Record<string, unknown> = {};
for (const [name, routeId] of selections) {
  const patterns = ["0", "1"].map((direction) => {
    const candidates = [...shapes.values()]
      .filter((s) => s.route === routeId && s.direction === direction)
      .map((s) => ({ ...s, stops: representatives.get(s.trip)!.stops }))
      .filter((s) => {
        const [start, end] =
          direction === "0"
            ? terminals[name]!
            : [...terminals[name]!].reverse();
        return (
          cleanName(stopRows.get(s.stops[0]!)!.stop_name!) === start &&
          cleanName(stopRows.get(s.stops.at(-1)!)!.stop_name!) === end
        );
      });
    candidates.sort(
      (a, b) =>
        b.stops.length - a.stops.length ||
        b.count - a.count ||
        a.trip.localeCompare(b.trip),
    );
    if (!candidates[0]) throw new Error(`No pattern ${routeId}/${direction}`);
    return candidates[0];
  });
  const mode = name.startsWith("U")
    ? "metro"
    : name.endsWith("A")
      ? "bus"
      : "tram";
  const route = routes.get(routeId)!;
  const normalize = (ids: string[]) =>
    ids.map(stationId).filter((id, i, all) => i === 0 || id !== all[i - 1]);
  lines.push({
    id: name,
    name,
    mode,
    pool: name === "U6" ? "u6" : mode,
    color: "#" + route.route_color,
    stops: normalize(patterns[0]!.stops),
    returnStops: normalize(patterns[1]!.stops),
    headway: mode === "metro" ? 180 : mode === "tram" ? 300 : 420,
    capacity:
      name === "U6" ? 500 : mode === "metro" ? 700 : mode === "tram" ? 180 : 85,
  });
  manifest[name] = {
    routeId,
    description: route.route_long_name,
    directions: patterns.map((p) => ({ trip: p.trip, gtfsStops: p.stops })),
  };
}
const average = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const stations: Station[] = [...grouped].map(([id, s]) => ({
  id,
  name: s.name,
  lat: +average(s.lat).toFixed(7),
  lon: +average(s.lon).toFixed(7),
  x: 0,
  y: 0,
}));
const minLon = Math.min(...stations.map((s) => s.lon!)),
  maxLon = Math.max(...stations.map((s) => s.lon!));
const minLat = Math.min(...stations.map((s) => s.lat!)),
  maxLat = Math.max(...stations.map((s) => s.lat!));
for (const s of stations) {
  s.x = Math.round(60 + ((s.lon! - minLon) / (maxLon - minLon)) * 1480);
  s.y = Math.round(60 + ((maxLat - s.lat!) / (maxLat - minLat)) * 1180);
}
stations.sort((a, b) => a.id.localeCompare(b.id));
for (const line of lines)
  console.log(
    `${line.id}: ${line.stops.length}/${line.returnStops!.length}: ${line.stops.map((id) => grouped.get(id)!.name).join(" → ")}`,
  );
const network: TransitNetwork = {
  version: "vienna-normal-2026-10-26-v1",
  sources: [
    {
      title:
        "Datenquelle: Stadt Wien – Wiener Linien, Fahrplandaten GTFS; Export 2026-10-26",
      url: URL,
      retrieved,
      license: "CC BY 4.0",
    },
    {
      title: "Wiener Linien – Fahrplandaten GTFS Wien (Datenkatalog)",
      url: "https://www.data.gv.at/datasets/ab4a73b6-1c2d-42e1-b4d9-049e04889cf0",
      retrieved,
      license: "CC BY 4.0",
    },
    {
      title: "Wiener Linien Open Data",
      url: "https://tramwm.wienerlinien.at/web/guest/open-data",
      retrieved,
      license: "CC BY 4.0",
    },
  ],
  stations,
  lines,
  connectors: [],
  transfers: [],
};
const link = (
  station: string,
  from: string,
  to: string,
  fictional = false,
  toStation?: string,
) => {
  const stationId = slug(station),
    toStationId = toStation ? slug(toStation) : undefined;
  for (const [lineId, id] of [
    [from, stationId],
    [to, toStationId ?? stationId],
  ]) {
    const line = lines.find((l) => l.id === lineId)!;
    if (![...line.stops, ...line.returnStops!].includes(id!))
      throw new Error(`Connector missing ${lineId}: ${id}`);
  }
  network.connectors.push({
    stationId,
    ...(toStationId ? { toStationId } : {}),
    fromLineId: from,
    toLineId: to,
    seconds: fictional ? 120 : 90,
    fictional,
  });
};
link("Karlsplatz", "U1", "U2", true);
link("Karlsplatz", "U1", "U4", true);
link("Karlsplatz", "U2", "U4", true);
link("Landstraße", "U3", "U4", true);
// Conservative curated subset of junctions/shared track, deliberately not every passenger interchange.
for (const [stop, a, b] of [
  ["Börse", "D", "1"],
  ["Parlament", "D", "2"],
  ["Schwedenplatz", "1", "2"],
  ["Hintere Zollamtsstraße", "1", "O"],
  ["Quellenplatz", "6", "O"],
  ["Westbahnhof", "6", "18"],
] as const)
  link(stop, a, b);
const walk = (from: string, to: string, seconds: number) => {
  const a = slug(from),
    b = slug(to);
  if (!grouped.has(a) || !grouped.has(b))
    throw new Error(`Walking transfer missing ${from}/${to}`);
  network.transfers.push({ from: a, to: b, seconds });
};
walk("Karlsplatz", "Oper/Karlsplatz", 180);
walk("Hauptbahnhof", "Hauptbahnhof Ost", 240);
walk("Burggasse-Stadthalle", "Urban-Loritz-Platz", 120);
walk("Volkstheater", "Parlament/Volkstheater", 180);
walk("Südtiroler Pl. - Hbf.", "Hauptbahnhof", 180);
walk("Meidling", "Meidling, Schedifkaplatz", 180);
await Bun.write(
  "src/data/network.json",
  JSON.stringify(network, null, 2) + "\n",
);
await Bun.write(
  "src/data/import-manifest.json",
  JSON.stringify(
    {
      url: URL,
      sha256: SHA256,
      retrieved,
      exported: "2026-10-26",
      selections: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${stations.length} stations; ${lines.length} lines; ${network.connectors.length} connectors; ${network.transfers.length} walking transfers`,
);
