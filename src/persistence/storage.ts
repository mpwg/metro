import type { GameState, SavedGame } from "../shared/types";
const DB_NAME = "metro-wien";
const STORE = "saves";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () =>
      reject(new Error("Lokaler Speicher ist nicht verfügbar."));
    request.onblocked = () =>
      reject(new Error("Bitte andere Metro-Tabs schließen."));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        new Error("Spielstand konnte nicht gelesen oder gespeichert werden."),
      );
    };
  });
}
export function validateSave(
  value: unknown,
  networkVersion: string,
): SavedGame {
  if (!value || typeof value !== "object")
    throw new Error("Der Spielstand ist beschädigt.");
  const save = value as SavedGame;
  const s = save.state;
  if (
    save.format !== "metro-save" ||
    save.version !== 1 ||
    !s ||
    s.schemaVersion !== 1
  )
    throw new Error("Unbekanntes Spielstandformat.");
  if (s.networkVersion !== networkVersion)
    throw new Error("Der Spielstand gehört zu einer anderen Netzversion.");
  if (
    !Array.isArray(s.vehicles) ||
    !Array.isArray(s.events) ||
    !Array.isArray(s.replacementLines) ||
    !s.waiting ||
    !s.metrics ||
    ![
      s.time,
      s.randomState,
      s.seed,
      s.nextVehicleId,
      s.nextEventId,
      s.nextRandomEventAt,
      ...Object.values(s.metrics),
    ].every(Number.isFinite) ||
    Object.values(s.waiting).some((groups) => !Array.isArray(groups)) ||
    s.vehicles.some(
      (v) =>
        typeof v.id !== "string" ||
        !Array.isArray(v.passengers) ||
        !Number.isFinite(v.progress),
    )
  ) {
    throw new Error("Der Spielstand ist unvollständig oder beschädigt.");
  }
  return save;
}
export async function saveGame(state: GameState): Promise<void> {
  const save: SavedGame = {
    format: "metro-save",
    version: 1,
    savedAt: new Date().toISOString(),
    state: structuredClone(state),
  };
  validateSave(save, state.networkVersion);
  await transaction("readwrite", (store) => store.put(save, "current"));
}
export async function loadGame(
  networkVersion: string,
): Promise<SavedGame | null> {
  const value = await transaction("readonly", (store) => store.get("current"));
  return value ? validateSave(value, networkVersion) : null;
}
export async function deleteGame(): Promise<void> {
  await transaction("readwrite", (store) => store.delete("current"));
}
