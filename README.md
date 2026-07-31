# 💣 Bomberman LAN

Domácí síťová verze ve stylu Atomic Bomberman pro **2–8 hráčů** po domácí síti (wifi).
Každý hraje na svém počítači, na jednom počítači můžou být i **2 hráči** naráz.

> Grafika, zvuky i kód jsou vlastní (originální Atomic Bomberman assety jsou chráněné) —
> ale herní logika je ve stejném duchu: mřížkové mapy s pilíři, ničitelné cihly, bomby
> s řetězovými výbuchy, power-upy a poslední přeživší vyhrává.

## Jak to spustit

Potřebuješ **Node.js** (verze 18+). Pak v této složce:

```bash
npm install      # jen poprvé
npm start        # spustí server
```

Server vypíše adresy, např.:

```
Na tomto počítači:   http://localhost:3000
Pro ostatní na wifi: http://192.168.50.236:3000
```

- **Ty** (co jsi spustil server) otevřeš `http://localhost:3000`.
- **Ostatní** ve stejné wifi otevřou tu druhou adresu (`http://192.168...:3000`) v prohlížeči na svém počítači/notebooku.
- Všichni zadají **stejný kód místnosti** (výchozí `HRA`), napíšou jméno a připojí se.
- Až je vás 2+, kdokoli klikne **Spustit hru**. Hraje se na kola pořád dokola.

Jiný port: `PORT=8080 npm start`

## Ovládání

Klávesy si **každý nastaví na úvodní obrazovce** (klikneš na klávesu a stiskneš novou;
uloží se do prohlížeče). Výchozí nastavení:

| | Pohyb | Bomba | Ruční odpal |
|---|---|---|---|
| **1 hráč na počítači** | šipky | `Mezerník` | `Enter` |
| **2 hráči — Hráč 1** | `W` `A` `S` `D` | `Mezerník` | `Q` |
| **2 hráči — Hráč 2** | šipky | `Enter` | pravý `Shift` |

Ruční odpal využiješ jen když máš bonus 🎮 — pak bomby čekají a odpálíš je klávesou.

**Na mobilu / tabletu** se ovládá dotykem: hrací plocha je rozdělená křížem na 4 zóny —
ťukni (nebo drž) v horní/dolní/levé/pravé části a panáček jde tím směrem.
**2× rychle ťuknout = položit bombu**, **3× ťuknout = ruční odpal**.

Tlačítkem **⛶** (vlevo nahoře ve hře) přepneš na **celou obrazovku** — schová se lišta
prohlížeče a zůstane jen samotná hra.

Sólo? Stačí **1 člověk + boti** — v lobby zvolíš počet (1–7) a úroveň botů a spustíš.

## Boti, mapy a časový limit

V lobby (než spustíte hru) může kdokoli nastavit:

- **Boti** – tlačítkem „+ Bot" přidáš počítačového hráče ve třech úrovních:
  - 🤖 **Nováček** – pomalá reakce, dělá chyby, spíš se motá.
  - 🤖 **Zkušený** – slušně uhýbá výbuchům, jde po cihlách i po tobě.
  - 🤖 **Mistr** – rychlá reakce, spolehlivě uhýbá, cíleně tě loví a hlídá si únik.

  Boti se počítají mezi hráče (klidně 1 člověk + 7 botů). Křížkem u bota ho odebereš.
  Mají vlastní jména (Bombík, Dynamit, …) a aktivně sbírají bonusy.

  Každý hráč má navíc **vlastní avatar** – liší se nejen barvou, ale i tvarem
  (anténka, uši, hřebínek, rohy, koruna, kšiltovka, mašle, svatozář).
- **Mapa** – 8 fantasy prostředí (Louka, Hradní sklepení, Ohnivá jeskyně, Ledová pláň,
  Kouzelný les, Vesmírná loď, Pouštní ruiny, Cukrové království) nebo **🎲 Náhodná**
  (jiná každé kolo).
- **Velikost** – Malá (15×11), Střední (19×13) nebo Velká (25×15). Větší mapa = víc
  místa; políčka se automaticky zmenší, aby se mapa vešla na obrazovku.
- **Množství bonusů** – Málo / Středně / Hodně (kolik cihel odhalí bonus). Bonusy navíc
  po ~7 s zmizí (ke konci blikají), takže se nehromadí.
- **Časový limit** – po jeho vypršení přijde **náhlá smrt**: do bludiště se vypustí
  **👾 lovec (Pac-Man)**, který aktivně honí přeživší a žere je. Je o třetinu rychlejší
  než nejrychlejší hráč a prokouše se i cihlami → nikdo se neschová donekonečna.
- **🌀 Teleporty** – občas se na mapě na ~4 s objeví portál; kdo do něj vstoupí, přenese
  se náhodně jinam. Dá se vypnout.

## Power-upy

- 💣 **Bomba** – můžeš mít víc bomb naráz
- 🔥 **Oheň** – větší dosah výbuchu
- ⚡ **Rychlost** – běháš rychleji
- 🦶 **Kop** – nakopneš bombu a odkutálí se
- 🎮 **Ruční odpal** – tvoje bomby už nebouchnou samy, odpálíš je klávesou (viz níže).
  Když stejný bonus sebereš znovu, zase se vypne (přepínač).

## Přihlášení a statistiky (nepovinné)

Na úvodní obrazovce se můžeš **zaregistrovat** (přezdívka + heslo). Přihlášení:

- **si tě pamatuje i příště** (i po měsících – token v prohlížeči),
- **rezervuje ti jméno** – nikdo jiný ho jako host nepoužije,
- **sbírá statistiky**: počet her, výher, kolikrát jsi někoho odpálil, kolikrát jsi umřel,
  kolik bonusů jsi sebral, a tabulku „koho jsem odpálil / kdo odpálil mě".

Statistiky otevřeš tlačítkem **📊**. Kdo se přihlásit nechce, hraje dál jako host.

> Účty se ukládají na serveru do `data/users.json`. Hesla jsou solená a hashovaná
> (scrypt). Při aktualizaci na serveru tenhle soubor **nemaž**, ať účty nezmizí.

## Tipy

- Nejlepší je notebook/PC s klávesnicí. Kdo umře, kouká jako duch a čeká na další kolo.
- Server musí běžet po celou dobu hraní na jednom počítači.
- Zavření: `Ctrl+C` v terminálu, kde běží server.

## Jak to je uvnitř

- `constants.js` – sdílené konstanty, definice map a pomocné funkce.
- `game.js` – **autoritativní** herní logika (server počítá celou hru na 60 Hz, klientům
  posílá stav 30×/s). Klient jen posílá vstupy a kreslí → nejde podvádět a nerozjede se to.
- `bot.js` – AI botů (uhýbání před výbuchy a hledání cílů přes BFS, tři obtížnosti).
- `server.js` – HTTP server + WebSocket, správa místností, nastavení a kol.
- `public/` – webový klient (canvas, vykreslování map/témat, zvuky, vstupy, HUD).
