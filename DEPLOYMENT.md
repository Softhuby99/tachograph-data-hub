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

## Hinweise

- Manuelle Edits in „Card & Certification" werden pro Browser im `localStorage`
  gespeichert, nicht serverseitig. Fuer geteilte Aenderungen `standalone/data.json`
  aktualisieren und neu deployen.
- Die JRC-/TED-Update-Pruefung ist Teil der Cloud-Version des Tools und in
  diesem statischen Deployment nicht enthalten.
