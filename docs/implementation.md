# Umsetzung und Fortschritt

- [x] Konzept freigegeben und unabhängiger Builder-Check durchgeführt.
- [x] Bun-Projekt und gemeinsame Typen.
- [x] Netzdaten und Quellen: Daten-Agent, src/data und scripts/import-network.ts.
- [x] Simulation und Tests: Simulations-Agent, src/sim und tests/sim*.
- [x] Oberfläche, Worker und Speicherung: Projektverantwortlicher. Chromium/Firefox-Kurzlauf und je 65 Sekunden bei 5× erfolgreich, nach den Review-Korrekturen wiederholt.
- [x] Unabhängige Abschlussprüfung; geprüfter Stand für Commit und Veröffentlichung unter `mpwg/metro` vorbereitet.

Agenten arbeiten mit getrennten Dateiverantwortungen und kompakten Aufträgen. Maximal zwei Implementierer parallel, ein gezieltes Abschlussreview. Ruling: Neues leeres Projekt wird direkt im freigegebenen Projektordner initialisiert; es gibt keinen vorhandenen Entwicklungsstand, der ein zusätzliches Worktree benötigt.

Verträge: src/shared/types.ts. Simulation exportiert createGame(network, seed?), stepGame(network, state, seconds?), executeCommand(network, state, command), previewCommand(network, state, command), getServiceStops(line, direction). stepGame/executeCommand verändern den übergebenen Zustand; Vorschau bleibt rein. Konfiguration zentral in src/sim/config.ts. Netz exportiert network aus src/data/network.ts.

## Review und Verifikation

Ein unabhängiges Abschlussreview reproduzierte zwei wichtige Randfälle: nicht fahrbare Fahrgastetappen durch zusammengeführte Richtungswechsel und zu frühe Entfernung einer Ersatzbuslinie mit noch ausstehenden Betriebsfahrten. Beide wurden mit Regressionstests korrigiert und unabhängig nachgeprüft; keine wichtigen Restbefunde. Außerdem wurden manuelle Sperren an ausschließlich in der Rückrichtung bedienten Halten ergänzt. Nichtblockierende Modellgrenze: Zufallsereignisse wählen ihren Ausgangshalt weiterhin aus der Hinrichtung; die manuelle Auswahl deckt beide Richtungen ab.

Abschlussnachweise: 36 Bun-Tests einschließlich 30 Spielminuten im gesamten Netz, aller 335² Stationspaare und 55 Spielminuten für die SEV-Regression. Typprüfung und statischer Build erfolgreich. Je 65 echte Sekunden Browserbetrieb bei 5× nach Korrekturen; 1600×1000 und 1366×768 geprüft, Bilanzen erhalten und exaktes pausiertes Fortsetzen bestätigt. Browserbibliotheken wurden wegen fehlender sudo-Berechtigung lokal im ignorierten Cache bereitgestellt; kein Node-Prozess für Entwicklung, Build oder Tests erforderlich.
