# TDH = Tacho Data Hub

Deployment des **Tachograph Cards Info Tool** (nginx im Docker-Container,
Debian 12 Host).

Es gibt zwei Betriebsarten:

1. **Statisch (Default)** — Die App unter `standalone/` ist vollstaendig
   eigenstaendig: HTML, UI-Logik und alle 53 Datensaetze sind eingebettet.
   Keine Datenbank, kein Backend. Der Container liefert lediglich die Dateien
   per nginx aus.

2. **Mit lokaler PostgreSQL** — Zusaetzlich zum statischen Frontend laeuft ein
   PostgreSQL-Container mit dem vollen Datenbankschema (4 Tabellen) und allen
   53 Datensaetzen plus 1.283 JRC-Snapshot-Baselines. Damit ist die
   JRC-/TED-Update-Pruefung lokal verfuegbar (siehe Abschnitt 11).

---

# Start-Modi

Der Stack unterstuetzt vier Startmodi ueber `./scripts/run.sh <modus>`:

| Modus   | Umgebung | TLS                 | Port | Anwendungsfall                                           |
| ------- | -------- | ------------------- | ---- | -------------------------------------------------------- |
| `test1` | Test     | ohne                | 80   | Erster Funktionstest, beliebige IP/Hostname              |
| `test2` | Test     | self-signed HTTPS   | 443  | Lokale HTTPS-Tests (Zertifikat wird automatisch erzeugt) |
| `test3` | Live     | ohne                | 8080 | Produktive Domain hinter externem TLS-Proxy              |
| `test4` | Live     | Let's Encrypt HTTPS | 443  | Produktivbetrieb — siehe Abschnitt 10                    |

Starten / Stoppen:

```bash
./scripts/run.sh test1        # HTTP-only Testbetrieb
./scripts/stop.sh
```

Die Modi laden je ein `docker-compose.<modus>.yml` zusaetzlich zum Base-Compose;
`nginx/conf.d/site.conf` (produktiv) bleibt in allen Test-Modi ungenutzt und
unangetastet.

---

# Lokaler HTTP-Test (Modus `test1`)

Diese Anleitung startet den vollen Stack lokal auf Port 80, ohne TLS und ohne
Let's Encrypt. Ideal fuer den ersten Funktionstest auf dem Debian-Server.

## Voraussetzungen

- Debian 12 (oder vergleichbare Linux-Distribution)
- Docker + Docker Compose Plugin installiert
- User `deploy` in der Gruppe `docker`
- Port 80 frei (kein anderer Webserver)
- ca. 500 MB freier Speicherplatz
- Keine Domain, DNS oder TLS notwendig

Docker installieren (falls noch nicht vorhanden, als root):

```bash
apt update && apt install -y ca-certificates curl git openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

## 1. Vorbereitung als root

```bash
useradd -m -s /bin/bash deploy 2>/dev/null || true
usermod -aG docker deploy
mkdir -p /opt/TDH
chown -R deploy:deploy /opt/TDH
ufw allow 80        # nur falls ufw aktiv ist
```

## 2. Projekt als deploy bereitstellen

```bash
su - deploy
cd /opt/TDH
git clone <REPO-URL> .      # oder: Projektarchiv entpacken
cp .env.example .env
```

Benoetigt werden mindestens: `Dockerfile`, `docker-compose*.yml`, `nginx/`,
`scripts/`, `standalone/`.

```bash
chmod +x scripts/*.sh
```

## 3. `.env` anpassen

```bash
PUBLIC_BASE_URL=http://<server-ip-oder-localhost>
DOMAIN=tdh.example.com
LETSENCRYPT_EMAIL=you@example.com
```

## 4. Stack starten (HTTP-only)

```bash
cd /opt/TDH
./scripts/run.sh test1
docker compose logs -f web      # bis "start worker process" erscheint
```

## 5. Test der Seiten

- `http://<server-ip>/` — Tool-Startseite (Data-View)
- `http://<server-ip>/healthz` — muss `ok` liefern
- `http://<server-ip>/data.json` — Rohdaten der 53 Datensaetze

Schnelltest von der Shell:

```bash
curl -I http://localhost/
curl    http://localhost/healthz
```

In der Oberflaeche pruefen: Filter (Country / Generation / Manufacturer),
Detailansicht mit Flagge, Tab **Market Analytics**, Edit-Button in
„Card & Certification" (Aenderungen liegen im `localStorage` des Browsers).

## 6. Daten aktualisieren

Die Datensaetze stecken in `standalone/index.html` bzw. `standalone/data.json`.
Nach einer Aenderung:

```bash
./scripts/run.sh test1      # baut das Image neu und startet neu
```

## 7. Stack stoppen

```bash
./scripts/stop.sh
```

Mit `./scripts/stop.sh -v` werden zusaetzlich angelegte Volumes entfernt.

## 8. Weitere Test-Modi

- **`./scripts/run.sh test2`** — self-signed HTTPS. Beim ersten Start wird
  `nginx/certs/{fullchain,privkey}.pem` per `openssl` erzeugt. Browser warnen
  wegen des unbekannten Ausstellers — das ist gewollt.
- **`./scripts/run.sh test3`** — HTTP-only auf Port 8080 mit produktiver Domain
  in `PUBLIC_BASE_URL`, gedacht fuer den Betrieb hinter einem externen
  TLS-Terminator (Cloudflare, Traefik, o. ae.).

## 9. Autostart nach Server-Reboot

Die Container laufen mit `restart: unless-stopped` und starten mit dem
Docker-Daemon automatisch wieder mit:

```bash
sudo systemctl enable docker
```

## 10. Produktivbetrieb (`test4`, Let's Encrypt)

Voraussetzung: DNS-A-Record der Domain zeigt auf den Server, Port 80 und 443
sind von aussen erreichbar.

1. `./scripts/stop.sh`
2. In `.env` setzen:
   ```bash
   PUBLIC_BASE_URL=https://tdh.example.com
   DOMAIN=tdh.example.com
   LETSENCRYPT_EMAIL=you@example.com
   ```
3. Zertifikat einmalig anfordern:
   ```bash
   ./scripts/init-letsencrypt.sh
   ```
4. Produktiv starten:
   ```bash
   ./scripts/run.sh test4
   ```
5. Firewall: `ufw allow 80 && ufw allow 443`

Der mitlaufende `certbot`-Container erneuert die Zertifikate alle 12 Stunden
automatisch. nginx nach einer Erneuerung neu laden:

```bash
docker compose -f docker-compose.yml -f docker-compose.test4.yml exec web nginx -s reload
```

## Troubleshooting

| Symptom                          | Pruefen / Loesung                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Port 80 bereits belegt           | `ss -tlnp \| grep :80` — anderen Dienst stoppen (System-nginx? `systemctl stop nginx`)   |
| `permission denied` bei Docker   | `groups` muss `docker` enthalten; neu einloggen oder `newgrp docker`                     |
| nginx crash-loopt                | Modus falsch — `./scripts/run.sh test1` statt `docker compose up` nutzen                 |
| 404 auf `/`                      | `docker compose exec web ls /usr/share/nginx/html` — `index.html` muss vorhanden sein    |
| Aenderungen nicht sichtbar       | Image neu bauen: `./scripts/run.sh test1`; Browser-Cache leeren (Strg+F5)                |
| Flaggen fehlen                   | Server/Client braucht Internetzugang zu `flagcdn.com`, sonst greift der Emoji-Fallback   |
| TLS-Warnung im Browser (test2)   | Erwartet — self-signed Zertifikat, Ausnahme im Browser bestaetigen                       |
| certbot schlaegt fehl (test4)    | DNS-A-Record und Erreichbarkeit von Port 80 pruefen: `curl http://<domain>/.well-known/acme-challenge/test` |

---

# 11. Lokale PostgreSQL-Datenbank

Dieser Abschnitt beschreibt, wie du eine eigene PostgreSQL-Datenbank lokal
(oder im Docker-Stack) betreibst, das Schema anlegst und die 53 Datensaetze
plus JRC-Snapshot-Baseline importierst.

## Was wird benoetigt?

| Komponente | Version | Zweck |
| ---------- | ------- | ----- |
| PostgreSQL | 14+ (16 empfohlen) | Datenbank-Server |
| `db/init.sql` | aus diesem Repo | Schema + Seed-Daten (53 Karten + 1.283 Snapshots) |
| `docker-compose.db.yml` | aus diesem Repo | Docker-Container fuer PostgreSQL (optional) |

Die Datei `db/init.sql` ist vollstaendig eigenstaendig: sie enthaelt das
komplette Schema (4 Tabellen, Indizes, Trigger-Funktion) **und** alle
Seed-Daten in Form von `INSERT`-Statements. Keine externen Abhaengigkeiten.

## 11.1 Tabellen-Uebersicht

| Tabelle | Datensaetze | Inhalt |
| ------- | ----------- | ------ |
| `tachograph_cards` | 53 | Konsolidierte Karten-Daten (Land, Generation, Hersteller, Zertifikate, Beschaffung) |
| `jrc_source_snapshots` | 1.283 | Fingerabdruecke aller JRC-Eintraege — dient als Diff-Baseline fuer die Update-Pruefung |
| `jrc_update_proposals` | 0 (runtime) | Ausstehende Update-Vorschlaege — wird bei jeder Pruefung gefuellt |
| `jrc_check_runs` | 0 (runtime) | Verlauf der bisherigen Update-Pruefungen — wird bei jeder Pruefung gefuellt |

Die beiden letzten Tabellen starten leer und fuellen sich beim ersten
„Check for updates"-Lauf.

## 11.2 Option A: PostgreSQL im Docker-Container (empfohlen)

### 11.2.1 Nur die Datenbank starten

```bash
cd /opt/TDH
docker compose -f docker-compose.db.yml up -d
```

Beim ersten Start wird `db/init.sql` automatisch ausgefuehrt (Schema +
Seed-Daten). Danach ist die Datenbank unter `localhost:5432` verfuegbar.

### 11.2.2 Web-Stack + Datenbank zusammen starten

```bash
cd /opt/TDH
docker compose \
  -f docker-compose.yml \
  -f docker-compose.test1.yml \
  -f docker-compose.db.yml \
  up -d
```

Das Frontend laeuft auf Port 80, die Datenbank auf Port 5432.

### 11.2.3 Verbindung testen

```bash
docker exec -it tdh-db psql -U tdh -d tdh -c "SELECT count(*) FROM tachograph_cards;"
# Erwartet: 53

docker exec -it tdh-db psql -U tdh -d tdh -c "SELECT count(*) FROM jrc_source_snapshots;"
# Erwartet: 1283
```

### 11.2.4 Daten neu importieren (Reset)

Um das Schema und die Seed-Daten neu aufzubauen (z. B. nach einer
Aktualisierung von `db/init.sql`):

```bash
docker compose -f docker-compose.db.yml down -v   # Volume loeschen
docker compose -f docker-compose.db.yml up -d     # neu starten, init.sql laeuft automatisch
```

> **Achtung:** `down -v` loescht alle Daten im Volume, including runtime-
> Daten (`jrc_update_proposals`, `jrc_check_runs`). Nur ausfuehren, wenn du
> die Datenbank neu aufbauen willst.

### 11.2.5 Zugangsdaten anpassen

In `.env` ergaenzen (oder beim `docker compose`-Befehl `-e` verwenden):

```bash
POSTGRES_DB=tdh
POSTGRES_USER=tdh
POSTGRES_PASSWORD=tdh_secret          # bitte aendern!
```

## 11.3 Option B: PostgreSQL direkt auf dem Host (ohne Docker)

### 11.3.1 PostgreSQL installieren (Debian 12)

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

### 11.3.2 Datenbank und User anlegen

```bash
sudo -u postgres psql << 'SQL'
CREATE USER tdh WITH PASSWORD 'tdh_secret';
CREATE DATABASE tdh OWNER tdh;
SQL
```

### 11.3.3 Schema + Seed-Daten importieren

```bash
psql -U tdh -d tdh -h localhost -f db/init.sql
```

Wenn du nach dem Passwort gefragt wirst, `tdh_secret` eingeben.

### 11.3.4 Import verifizieren

```bash
psql -U tdh -d tdh -h localhost -c "SELECT count(*) FROM tachograph_cards;"
psql -U tdh -d tdh -h localhost -c "SELECT count(*) FROM jrc_source_snapshots;"
```

### 11.3.5 Daten aktualisieren

Um die Seed-Daten zu aktualisieren (z. B. neue Version von `db/init.sql`):

```bash
# Tabellen leeren, dann neu importieren
psql -U tdh -d tdh -h localhost -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -U tdh -d tdh -h localhost -f db/init.sql
```

## 11.4 Daten manuell exportieren (CSV)

Fuer Backups oder den Transfer auf einen anderen Server:

```bash
# Docker
docker exec tdh-db psql -U tdh -d tdh \
  -c "COPY tachograph_cards TO STDOUT WITH CSV HEADER" > backup_cards.csv

# Host
psql -U tdh -d tdh -h localhost \
  -c "COPY tachograph_cards TO STDOUT WITH CSV HEADER" > backup_cards.csv
```

## 11.5 Verbindung aus der App

Die statische Frontend-App (`standalone/index.html`) arbeitet eingebettet
und benoetigt keine Datenbank. Die lokale PostgreSQL-Datenbank ist fuer den
Betrieb der **JRC-/TED-Update-Pruefung** gedacht: Die Server-Funktionen des
Tools verbinden sich mit der Datenbank, lesen die Snapshots, vergleichen mit
den JRC-Quellen und schreiben neue Vorschlaege in `jrc_update_proposals`.

Damit die Server-Funktionen die lokale Datenbank erreichen, folgende
Umgebungsvariablen setzen (in `.env` oder beim Start):

```bash
# Fuer die lokale PostgreSQL (statt Lovable Cloud)
DB_HOST=localhost          # bzw. tdh-db im Docker-Netzwerk
DB_PORT=5432
DB_NAME=tdh
DB_USER=tdh
DB_PASSWORD=tdh_secret
```

> **Hinweis:** Die Server-Funktionen muessen angepasst werden, um die lokale
> PostgreSQL-Verbindung statt des Supabase-Clients zu verwenden. Das
> Frontend (Data-View, Market Analytics) funktioniert auch ohne Datenbank,
> da es die eingebetteten `data.json`-Daten verwendet.

## 11.6 Datenbank-Wartung

### Backup (Dump)

```bash
# Docker
docker exec tdh-db pg_dump -U tdh tdh > backup_$(date +%Y%m%d).sql

# Host
pg_dump -U tdh -h localhost tdh > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
psql -U tdh -d tdh -h localhost -f backup_20260811.sql
# bzw. im Container:
docker exec -i tdh-db psql -U tdh -d tdh < backup_20260811.sql
```

### Indizes neu aufbauen (bei Performance-Rueckgang)

```bash
docker exec tdh-db psql -U tdh -d tdh -c "REINDEX DATABASE tdh;"
```

---

## Hinweise

- Manuelle Edits in „Card & Certification" werden pro Browser im `localStorage`
  gespeichert, nicht serverseitig. Fuer geteilte Aenderungen `standalone/data.json`
  aktualisieren und neu deployen.
- Die JRC-/TED-Update-Pruefung benoetigt die lokale PostgreSQL-Datenbank
  (Abschnitt 11). Ohne Datenbank ist die statische App voll funktionsfaehig,
  jedoch ohne Update-Monitoring.
