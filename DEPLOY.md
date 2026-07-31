# Nasazení na VPS (hraní přes internet)

Ano — hra funguje přes internet úplně stejně jako na LAN, je to jen WebSocket přes TCP.
Stačí ji spustit na VPS a poslat lidem odkaz. Níže dvě varianty: rychlá a „pořádná".

---

## Co budeš potřebovat
- VPS s **Node.js 18+** (`node -v`).
- Otevřený port (např. 3000), nebo reverzní proxy s doménou.

Zkopíruj celou složku projektu na VPS (přes `scp`, `git`, `rsync`…) a nainstaluj závislosti:

```bash
cd bomberman
npm install --omit=dev
```

---

## Varianta A — rychlá (IP + port)

```bash
PORT=3000 node server.js
```

Lidé otevřou `http://IP_TVOJI_VPS:3000`, zadají stejný kód místnosti a hrají.

Aby server běžel i po odhlášení a restartoval se, použij **pm2**:

```bash
npm install -g pm2
PORT=3000 pm2 start server.js --name bomberman
pm2 save && pm2 startup      # spustí se i po rebootu VPS
```

Nezapomeň **otevřít port** ve firewallu VPS:
```bash
sudo ufw allow 3000/tcp      # Ubuntu/Debian
```
(U cloud VPS ještě povol port v jejich webovém firewallu / security group.)

> Pozn.: přes čisté `http://IP:port` používá hra `ws://`. Funguje, ale některé sítě
> nešifrovaný provoz blokují a prohlížeč může varovat. Pro veřejné hraní doporučuju
> variantu B s HTTPS.

---

## Varianta B — pořádná (doména + HTTPS, doporučeno)

Nasměruj doménu (např. `bomberman.tvojedomena.cz`) na IP VPS a dej před hru
**Caddy** — sám vyřídí HTTPS certifikát i WebSocket.

1. Spusť hru na localhost přes pm2 (jako výše, `PORT=3000`).
2. Nainstaluj Caddy a vytvoř `/etc/caddy/Caddyfile`:

```
bomberman.tvojedomena.cz {
    reverse_proxy localhost:3000
}
```

3. `sudo systemctl reload caddy`

Hotovo — lidé otevřou `https://bomberman.tvojedomena.cz`. Klient sám pozná HTTPS
a použije zabezpečené `wss://` (je to už ošetřené v kódu).

<details>
<summary>Alternativa: nginx místo Caddy</summary>

```nginx
server {
    listen 443 ssl;
    server_name bomberman.tvojedomena.cz;
    # ssl_certificate ... (např. z certbotu)

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # důležité pro WebSocket
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
</details>

---

## Dobré vědět

- **Latence**: přes internet je odezva vyšší než na LAN. Hra běží autoritativně na serveru
  a nemá predikci pohybu, takže tvoje postava reaguje se zpožděním jednoho okruhu k serveru
  a zpět (typicky ~30–80 ms na běžném připojení = plně hratelné). Vyber VPS **blízko hráčům**.
  Hráči z druhého konce světa budou mít znatelnější lag.
- **Soukromí**: kdokoli s odkazem a kódem místnosti se může připojit. Pro soukromou hru
  použij nezřejmý kód místnosti. (Účty/hesla hra nemá.)
- **Provoz je malý** – JSON stavy 30×/s, pár kB/s na hráče.
- **Restart hry**: `pm2 restart bomberman`. Logy: `pm2 logs bomberman`.
