# Nasazení za stávající nginx (krok za krokem)

Postup pro Debian/Ubuntu. **Nepoužíváme Caddy** — použijeme tvůj nginx, aby nedošlo
ke konfliktu na portech 80/443. Node poběží lokálně na `127.0.0.1:3000`, nginx ho
vystaví na doméně přes HTTPS.

Příkazy spouštěj na **serveru** (přes SSH). Kde je `sudo`, potřebuješ práva roota.

---

## 0) Node.js 18+ na serveru
```bash
node -v    # když chybí nebo je starý:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 1) Nakopíruj projekt na server
Z tvého Macu (v adresáři `~/sites`):
```bash
rsync -av --exclude node_modules bomberman/ user@SERVER:/var/www/bomberman/
```
Pak na serveru nainstaluj závislosti:
```bash
cd /var/www/bomberman
npm install --omit=dev
sudo chown -R www-data:www-data /var/www/bomberman
```

## 2) Spusť hru jako službu (systemd)
```bash
sudo cp /var/www/bomberman/deploy/bomberman.service /etc/systemd/system/
which node                       # zkontroluj cestu k node…
sudoedit /etc/systemd/system/bomberman.service   # …a případně uprav ExecStart + WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now bomberman
sudo systemctl status bomberman  # měl by běžet (active/running)
curl -s localhost:3000 | head -c 60   # ověření, že Node odpovídá
```

## 3) DNS
V administraci domény nastav **A záznam** `bomberman.tvojedomena.cz` na IP serveru.
Než půjdeš dál, ověř: `dig +short bomberman.tvojedomena.cz` vrátí IP serveru.

## 4) Nginx reverzní proxy
```bash
sudo cp /var/www/bomberman/deploy/nginx-bomberman.conf /etc/nginx/sites-available/bomberman
sudoedit /etc/nginx/sites-available/bomberman        # uprav server_name na svou doménu
sudo ln -s /etc/nginx/sites-available/bomberman /etc/nginx/sites-enabled/
sudo nginx -t          # test konfigurace – musí projít
sudo systemctl reload nginx
```
Teď by hra měla jet na `http://bomberman.tvojedomena.cz`.

## 5) HTTPS certifikát (Let's Encrypt)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d bomberman.tvojedomena.cz
```
Certbot sám dopíše do konfigurace HTTPS blok (port 443) a nastaví přesměrování z HTTP.
Obnova certifikátu běží automaticky.

Hotovo → **`https://bomberman.tvojedomena.cz`**. Klient sám použije zabezpečené `wss://`.

---

## Firewall
Porty **80 a 443** už máš kvůli nginxu nejspíš otevřené. Port **3000 neotvírej** –
Node poslouchá jen na localhostu a chodí se na něj přes nginx.
```bash
sudo ufw allow 'Nginx Full'   # jen když ufw používáš a ještě to nemáš
```

## Údržba
```bash
sudo systemctl restart bomberman     # restart hry
journalctl -u bomberman -f           # živé logy
```
Aktualizace kódu: znovu `rsync`, pak `cd /var/www/bomberman && npm install --omit=dev && sudo systemctl restart bomberman`.

**Pozor:** účty a statistiky se ukládají do `/var/www/bomberman/data/users.json`.
Rsync bez `--delete` ho nechá být, ale nikdy ho ručně nemaž a `data/` nepřepisuj – přišel bys o účty.

Soubor obsahuje hashe hesel a přihlašovací tokeny – omez k němu přístup:
```bash
sudo chmod 700 /var/www/bomberman/data
sudo chmod 600 /var/www/bomberman/data/users.json   # až po prvním spuštění
```

## Časté zádrhely
- **Hra se nepřipojí / „Spojení ztraceno"** → v nginx configu chybí ty tři `Upgrade/Connection`
  řádky pro WebSocket (jsou v přiloženém configu).
- **502 Bad Gateway** → neběží Node služba (`systemctl status bomberman`) nebo špatný port.
- **certbot selže** → DNS ještě nemíří na server, nebo není otevřený port 80.
