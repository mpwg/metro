# Wiener Netz: Datenherkunft und Grenzen

**Datenquelle: Stadt Wien – Wiener Linien.** Fahrplan- und Haltestellendaten unter [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de), im Spiel verändert: Bahnsteige zusammengeführt, Regelbetriebsmuster ausgewählt und Koordinaten für eine schematische Darstellung projiziert. Der Spielcode hat eine eigene Lizenz.

Verwendet wird der öffentlich ohne Registrierung herunterladbare [offizielle GTFS-Export](https://www.wienerlinien.at/ogd_realtime/doku/ogd/gtfs/gtfs.zip), heruntergeladen am **01.11.2026**, Dateizeitstempel des Exports **26.10.2026**. [Datensatz und Lizenz im österreichischen Datenkatalog](https://www.data.gv.at/datasets/ab4a73b6-1c2d-42e1-b4d9-049e04889cf0); [Open-Data-Erklärung der Wiener Linien](https://tramwm.wienerlinien.at/web/guest/open-data). Die offizielle [Fahrplanseite](https://www.wienerlinien.at/fahrplaene) ist eine weiterführende Kontrollquelle; sie war beim Abruf durch einen Bot-Schutz nicht maschinell lesbar und wurde deshalb nicht als Datenbasis ausgegeben.

ZIP-SHA-256: `21cf933cf1970edde3cedf1e292bfa04780054361c44dc30295ea31cc4008913`.

## Enthaltenes Normalnetz

`src/data/network.json` enthält **335 Stationen**, **18 Linien**, jede mit eigener Hin- und Rückrichtung, **10 Gleisverbindungen** und **6 Fußwegverbindungen**. `src/data/import-manifest.json` hält URL, Hash, Abrufdatum, gewählte GTFS-Route, repräsentative Fahrt und sämtliche ursprünglichen Bahnsteig-IDs beider Richtungen fest. Der App-Einstieg ist `network` aus `src/data/network.ts`; die Anwendung benötigt keine Netzverbindung zum Datenanbieter.

| Linie | Haltestellen Hin / Rück |
| --- | --- |
| U1 | 24 / 24 |
| U2 | 21 / 21 |
| U3 | 21 / 21 |
| U4 | 20 / 20 |
| U6 | 24 / 24 |
| D | 32 / 32 |
| O | 23 / 24 |
| 1 | 29 / 30 |
| 2 | 32 / 34 |
| 6 | 18 / 18 |
| 18 | 25 / 27 |
| 31 | 25 / 25 |
| 43 | 15 / 15 |
| 49 | 23 / 24 |
| 13A | 18 / 20 |
| 14A | 16 / 14 |
| 15A | 23 / 22 |
| 48A | 22 / 22 |

Die Auswahl ist ausdrücklich **kein tagesaktueller Fahrplan**. Der Export enthält gleichzeitig Baustellen-, Veranstaltungs-, Kurz- und Einziehfahrten sowie mehrere zeitlich unterschiedliche Linienvarianten. Der Import wählt feste, geprüfte Varianten und vollständige Endstellenpaare. Innerhalb dieser Varianten wird das längste vollständige Muster je Richtung gewählt; bei Gleichstand entscheidet die Häufigkeit der Fahrten und danach die Fahrt-ID. Einziehfahrten etwa zum Betriebshof Rudolfsheim oder von Hernals werden so ausgeschlossen.

U2 verwendet `21-U2-j26-3` mit dem vollständigen Weg Seestadt–Karlsplatz statt der im gleichen Export enthaltenen Schottentor-Varianten. Das bildet bewusst den klassischen Normalbetrieb ab; es behauptet keine aktuelle Befahrbarkeit des innerstädtischen U2-Abschnitts. Der Export benennt Lina-Loos-Platz; darum sind es 21 Stationen. U6 verwendet `21-U6-j26-2` statt der als Baustellenfahrplan bezeichneten Variante `-1`. Linie 18 verwendet `22-18-j26-11` bis Stadion; die ältere Strecke nur bis Schlachthausgasse und gekürzte Westbahnhof-Führungen werden nicht übernommen. Die Rückrichtung enthält die echte Endstellenschleife `Stadion → Dr.-Natterer-Gasse → Stadion`; wiederholte Stations-IDs sind hier beabsichtigt. Linie 6 verwendet die vollständige Burggasse-Stadthalle–Geiereckstraße-Fahrt aus der Normalvariante, nicht den im Export zusätzlich enthaltenen Baustellenfahrplan 27.10.–04.12.2026.

**Keine Haltestellenfolge wurde frei aus dem Gedächtnis ergänzt.** Die bewusste Zusammenstellung historisch/zeitlich unterschiedlicher Normalvarianten ist eine Spielbaseline und kein einheitlicher realer Betriebstag. Asymmetrien etwa bei 13A, 14A, 15A, 2 und 49 bleiben erhalten; Rückrichtungen werden nicht pauschal gespiegelt. Angebotskalender und tatsächliche Abfahrtszeiten werden nicht simuliert.

## Stationen und Verbindungen

Bahnsteige mit gleichem normalisiertem Haltestellennamen bilden eine Station. Die stabilen IDs sind kleingeschriebene, ASCII-normalisierte Namen. Modus-Suffixe `S`/`U` entfallen; `Mitte-Landstraße` heißt im Spiel `Landstraße`, `Bahnhof Meidling` wird mit `Meidling` zusammengeführt. Die geographischen Koordinaten sind Mittelwerte der tatsächlich verwendeten Bahnsteige. Längen- und Breitengrad werden unabhängig linear auf x=60…1540 und y=60…1240 projiziert: geographisch orientierte Spielschematik, keine maßstäbliche Gleiskarte.

Gemeinsame Stations-IDs erlauben Fahrgastumstiege. **Fahrzeuge wechseln Linien ausschließlich über explizite Gleisverbindungen.** Die Daten enthalten jeweils eine Verbindung pro Linienpaar; die Simulation interpretiert diese bidirektional.

* Fiktiv und als solche markiert: U1↔U2, U1↔U4, U2↔U4 am Karlsplatz sowie U3↔U4 an der Landstraße. Je 120 Spielsekunden. Keine Verbindung zur U6.
* Bewusst kleine Auswahl realer gemeinsam befahrener Straßenbahnkorridore/Abzweige: D↔1 Börse, D↔2 Parlament, 1↔2 Schwedenplatz, 1↔O Hintere Zollamtsstraße, 6↔O Quellenplatz, 6↔18 Westbahnhof. Je 90 Spielsekunden. Keine automatische Verbindung an allen Kreuzungen oder Umsteigestationen. GTFS beweist keine Weichenlage; diese Liste ist kuratiert und keine vollständige Infrastruktur- oder Betriebsfreigabe.
* Fußwege: Karlsplatz↔Oper/Karlsplatz 180 s, Hauptbahnhof↔Hauptbahnhof Ost 240 s, Burggasse-Stadthalle↔Urban-Loritz-Platz 120 s, Volkstheater↔Parlament/Volkstheater 180 s, Südtiroler Pl. - Hbf.↔Hauptbahnhof 180 s, Meidling↔Meidling, Schedifkaplatz 180 s. Zeiten sind Spielannahmen, keine barrierefreien oder vermessenen Wege.

U6 bleibt im eigenen Fahrzeugpool, Busse im Buspool; Schiene und Bus haben keine Fahrzeugübergänge. Takte und Kapazitäten sind ebenfalls feste Spielannahmen: U1–U4 180 s/700, U6 180 s/500, Straßenbahn 300 s/180, Bus 420 s/85. Fahrzeugtypen, reale Wendezeiten, elektrische Anlagen, Einrichtungsbetrieb und Gleisgeometrie werden nicht aus GTFS hergeleitet.

## Reproduktion und Prüfung

Mit Bun und dem Systemprogramm `unzip`:

```sh
bun scripts/import-network.ts --zip /pfad/zum/gtfs.zip
bun test tests/network.test.ts
```

Ohne `--zip` lädt der Import die offizielle URL nach `/tmp/metro-official-gtfs.zip`. Der Import akzeptiert **nur den gepinnten SHA-256** und bricht bei einem inzwischen geänderten Download mit Hinweis auf manuelle Prüfung ab. Das 92-MB-Quellarchiv ist nicht im Repository; für bytegenaue spätere Reproduktion muss das passende Quellarchiv extern erhalten bleiben. Die eingecheckten normalisierten Daten und das Manifest sind dauerhaft offline nutzbar. Temporäre CSVs und ein Muster-Cache liegen unter `/tmp/metro-import-<hash>`; bei Änderungen der Auswahl den Cache löschen. Der Import liest die große `stop_times.txt` als Stream; Node wird nicht benötigt.

Die Datentests prüfen Linienmenge, vollständige Richtungen und Endstellen, Referenzintegrität, eindeutige Stations-IDs, Koordinatenbereich, Metro-Stationszahlen, echte Richtungsasymmetrie, Quellenangaben und isolierte Fahrzeugpools. Sie wurden zuerst ohne Datendatei ausgeführt (erwartet fehlgeschlagen), danach mit dem importierten Netz erfolgreich. Die Tests sind technische Konsistenzprüfung, keine externe Bestätigung jeder Weiche oder des aktuellen Betriebs.
