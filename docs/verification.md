# Technische Verifikation – 01.11.2026

Getestet mit Bun 1.4.4. Datenstand `vienna-normal-2026-10-26-v1`: 18 Linien, 335 Stationen. Alle Prüfbefehle liefen im Projektordner.

| Prüfung | Ergebnis |
| --- | --- |
| `bun install --frozen-lockfile` | Erfolgreich, reproduzierbarer Lockfile |
| `bun run typecheck` | Keine TypeScript-Fehler |
| `bun test tests` | 36 Tests, 0 Fehler; 4578 Assertions |
| `bun run build` | Statischer Build einschließlich Worker, Webfonts und Lizenztexten |
| Entwicklungsserver | Start und Worker-Build per Bun geprüft; HTTP 200 |
| Produktionsserver | HTML und Worker erfolgreich ausgeliefert |

Der erste GitHub-CI-Lauf zeigte für den Vollnetztest etwa sechs Sekunden Laufzeit und überschritt Buns Standardlimit von fünf Sekunden. Die beiden langen Simulationstests verwenden deshalb explizit 30 beziehungsweise 60 Sekunden Zeitbudget; simulierte Dauer und fachliche Assertions bleiben unverändert.

## Browserabläufe am Produktionsbuild

Chromium 156.0.8078.4 und Firefox 157.0 wurden tatsächlich als Headless-Desktop-Browser ausgeführt. Die Prüfung verwendet echte Worker-Zeit; keine emulierten Spieltimer.

Geprüft wurden Einführung, alle Linien und Stationen, Busauswahl, verzögerter Reserveeinsatz, Stationssuche, Andrang, Sperre, neue steuerbare Ersatzbuslinie, bestätigter Linienwechsel und Speichern. Anschließend je **65 Sekunden bei 5×**, pausieren, speichern, neu laden und exakter Zustandsvergleich einschließlich PRNG. Zusätzlich wurde das Layout auf **1600×1000** und **1366×768** auf Seitenüberlauf und erreichbare Zeitsteuerung geprüft.

| Browser | Spielsekunden im Dauerlauf | Fahrzeuge | Erzeugte Fahrgäste | Abgeschlossene Fahrten | Wartend | An Bord | Browserfehler |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 325 | 263 | 8873 | 16 | 4617 | 4240 | 0 |
| Firefox | 326 | 263 | 8873 | 16 | 4604 | 4253 | 0 |

Die kleine Zeitdifferenz folgt aus echten Timern. In beiden Läufen ist die Fahrgastbilanz exakt und der Fahrzeugbestand unverändert; Neuladen erhält den pausierten Spielzustand vollständig. Reproduzierbare Rohberichte und Screenshots erzeugt `bun run test:browser` unter dem ignorierten Ordner `test-results/`.

## Simulationsnachweise und Review

- Vollnetztest über 30 Spielminuten: endlicher Fahrzeugbestand, Fahrgastbilanz, Kapazitätsgrenzen, endliche Fahrzeugpositionen, begrenzte Kohorten und deterministisches Weiterlaufen nach JSON-Serialisierung.
- Alle **335² Stationspaare**: Jede berechnete Fahrgastetappe ist innerhalb einer einzelnen tatsächlichen Richtungsfolge fahrbar; Richtungswechsel benötigen eine neue Einstiegsetappe.
- 55 Spielminuten mit einem im Review gefundenen Ablauf: Eine Betriebsfahrt über eine später endende Ersatzbuslinie bleibt gültig; danach wird der nicht mehr benötigte Korridor aufgeräumt.
- Weitere Regressionen: Kapazität, Fußwege mit Umsteigezeit, Halten am nächsten Halt, Kurzführen, Defekte, Abziehen, Sperre nach Fahrwegvorschau, Ersatzbuswirkung und ausschließlich rückwärts bediente Stationen.
- Unabhängiges Abschlussreview und gezielte Nachprüfung: Beide wichtigen Befunde korrigiert; kein wichtiger Restbefund. Verbleibende Einschränkung: Zufallsereignisse nehmen ihre Ausgangshalte aus der Hinrichtung; manuelle Ereignisse unterstützen beide Richtungen.

Diese Nachweise bestätigen technische Abläufe des Spielmodells. Sie sind keine reale Verkehrsprognose, Infrastrukturprüfung oder menschliche Bewertung des Spielgefühls. Die Daten- und Modellgrenzen stehen in [Datenherkunft](data-sources.md).
