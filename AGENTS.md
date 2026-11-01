# Metro

Metro ist ein deutschsprachiges Desktop-Browserspiel. Verbindliches Konzept: `docs/design.md`; Netzdaten und Modellgrenzen: `docs/data-sources.md`.

- Verwende **Bun** für Installation, Skripte, Build und Tests. Kein npm/pnpm und kein Node-Prozess. `node:`-Kompatibilitätsmodule innerhalb Bun sind möglich.
- Oberfläche: React, TypeScript, SVG. Die Simulation in `src/sim/` ist unabhängig vom Browser. Der Worker besitzt den Spielzustand; die Oberfläche sendet typisierte Befehle.
- Gemeinsame Schnittstellen stehen in `src/shared/types.ts`. Änderungen daran zuerst mit den betroffenen Implementierern abstimmen. Simulationsschritte bleiben deterministisch; Zufall ausschließlich über den gespeicherten PRNG-Zustand.
- Hin- und Rückwege können unterschiedlich sein und Schleifen enthalten. Fahrgastumstiege und Fahrzeug-Gleisverbindungen sind getrennte Graphen. U6 ist ein eigener Fahrzeugpool.
- Fahrzeug- und Fahrgastbilanz, Kapazitäten sowie noch laufende Betriebsfahrten auch beim Ende einer Störung erhalten. Fahrwegvorschauen verändern keinen Zustand; Ausführung prüft erneut.
- Netzdaten sind ein gepinnter Offline-Datenstand. Datenänderungen benötigen Herkunftsnachweis und Prüfung beider Richtungen. Keine frei erfundenen realen Haltestellenfolgen.
- Vor Abschluss: `bun run typecheck`, `bun test tests`, `bun run build`. Bei Änderungen an Worker, Oberfläche oder Build zusätzlich `bun run test:browser` gegen den laufenden Produktionsbuild.
- Bei delegierter Arbeit höchstens zwei Implementierer gleichzeitig mit klar getrennten Dateien und kompaktem Kontext. Kleine Folgekorrekturen beim zuständigen Agenten belassen; unabhängige Reviews auf konkrete Risiken begrenzen.
- Eigener Code: AGPL-3.0-only. Netzdaten: CC BY 4.0. Lizenzhinweise der eingebetteten Schriften und Bibliotheken erhalten. Öffentliches Repository: `mpwg/metro`; Hosting gehört nicht zum Grundumfang.
