# Metro – freigegebenes Konzept

Deutschsprachiges Desktop-Leitstellenspiel für Wien. Bun ist das einzige Entwicklungsruntime. React/TypeScript und SVG bilden die Oberfläche; die deterministische Simulation läuft im Browser-Worker. Alle Stationen der U1/U2/U3/U4/U6, D/O/1/2/6/18/31/43/49 und 13A/14A/15A/48A gehören dazu.

Laufender Regelbetrieb, feste Fahrzeugbestände, Einführung, freie Endlossimulation. Einsatz, Abziehen, Zurückhalten, Kurzführen und Linienwechsel mit Fahrwegvorschau. Gemeinsamer Pool U1–U4; U6 getrennt. Markierte fiktive Verbindungsgleise Karlsplatz und Landstraße. Straßenbahnwechsel nur über explizite Verbindungen, Ersatzbusse auf vereinfachten Oberflächenkorridoren. Keine Teleportation; Betriebsfahrten benötigen Zeit. Fahrgäste steigen bei Linienwechseln aus.

Fahrgastandrang, Zugdefekt an Haltestellen, zeitlich begrenzte Streckensperren; automatische Reparatur. Bereits eingefahrene Fahrzeuge erreichen bei neuer Sperre die nächste Station. Fahrgastgruppen mit Zielen, Kapazitäten, Umstiegen und Neuberechnung bei Störungen. Aufgabe nach 30 Minuten Wartezeit. Pause und 1×/2×/5×. IndexedDB: manuell und alle 30 Sekunden; Laden pausiert, keine Offline-Fortschreibung.

Spielmodelle sind von realen Daten zu unterscheiden. Normalnetz mit dokumentiertem Datenstand, keine automatisch übernommenen Baustellensperren. Öffentliche Quellen mit Namensnennung, selbst geschriebener Code AGPL-3.0-only. Öffentliches Repository mpwg/metro; zunächst lokaler Start, kein Hosting.
