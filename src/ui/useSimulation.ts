import { useCallback, useEffect, useRef, useState } from "react";
import { network } from "../data/network";
import { loadGame, saveGame, deleteGame } from "../persistence/storage";
import type {
  CommandResult,
  GameCommand,
  GameState,
  WorkerRequest,
  WorkerResponse,
} from "../shared/types";

export function useSimulation() {
  const [state, setState] = useState<GameState>();
  const [paused, setPaused] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedAt, setSavedAt] = useState<Date>();
  const [restored, setRestored] = useState(false);
  const worker = useRef<Worker | null>(null);
  const nextRequest = useRef(0);
  const pending = useRef(
    new Map<
      number,
      {
        resolve: (result: CommandResult) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const send = useCallback(
    (message: WorkerRequest) => worker.current?.postMessage(message),
    [],
  );
  useEffect(() => {
    let alive = true;
    const instance = new Worker(
      new URL("simulation-worker.js", document.baseURI),
      { type: "module" },
    );
    worker.current = instance;
    instance.onerror = () =>
      setError(
        "Die Simulation konnte nicht gestartet werden. Bitte die Seite neu laden.",
      );
    instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (!alive) return;
      const message = event.data;
      if (message.type === "snapshot") {
        setState(message.state);
        setPaused(message.paused);
        setSpeed(message.speed);
      }
      if (message.type === "error") setError(message.message);
      if (message.type === "result") {
        const request = pending.current.get(message.requestId);
        if (request) {
          clearTimeout(request.timer);
          request.resolve(message.result);
          pending.current.delete(message.requestId);
        }
      }
      if (message.type === "save")
        saveGame(message.state)
          .then(() => {
            if (alive) {
              setSavedAt(new Date());
              setNotice("Spielstand lokal gespeichert.");
            }
          })
          .catch((e) => {
            if (alive) setNotice(e.message);
          });
    };
    loadGame(network.version)
      .then((save) => {
        if (!alive) return;
        setRestored(Boolean(save));
        if (save) setSavedAt(new Date(save.savedAt));
        instance.postMessage({
          type: "init",
          network,
          state: save?.state,
        } satisfies WorkerRequest);
      })
      .catch((e) => {
        if (!alive) return;
        setNotice(`${e.message} Ein neues Spiel wird geladen.`);
        instance.postMessage({ type: "init", network } satisfies WorkerRequest);
      });
    const autosave = setInterval(
      () =>
        instance.postMessage({
          type: "save",
          requestId: ++nextRequest.current,
        } satisfies WorkerRequest),
      30_000,
    );
    return () => {
      alive = false;
      clearInterval(autosave);
      instance.terminate();
      worker.current = null;
      pending.current.forEach((p) => {
        clearTimeout(p.timer);
        p.resolve({ ok: false, message: "Simulation wurde beendet." });
      });
      pending.current.clear();
    };
  }, []);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(id);
    }
  }, [notice]);
  const command = useCallback(
    (command: GameCommand, preview = false) =>
      new Promise<CommandResult>((resolve) => {
        if (!worker.current)
          return resolve({ ok: false, message: "Simulation lädt noch." });
        const requestId = ++nextRequest.current;
        const timer = setTimeout(() => {
          pending.current.delete(requestId);
          resolve({
            ok: false,
            message: "Die Simulation antwortet nicht. Bitte neu laden.",
          });
        }, 15_000);
        pending.current.set(requestId, { resolve, timer });
        send({ type: "command", command, preview, requestId });
      }),
    [send],
  );
  return {
    state,
    paused,
    speed,
    error,
    notice,
    savedAt,
    restored,
    command,
    setNotice,
    togglePause: () => send({ type: "pause", paused: !paused }),
    pause: () => send({ type: "pause", paused: true }),
    setSpeed: (speed: 1 | 2 | 5) => send({ type: "speed", speed }),
    save: () => send({ type: "save", requestId: ++nextRequest.current }),
    reset: async () => {
      await deleteGame().catch((e) => setNotice(e.message));
      setRestored(false);
      send({ type: "init", network, seed: 42 });
    },
  };
}
