# Skener knihovny

Mobilní webová aplikace (PWA) pro rychlé přidávání knih do knihovny. Načte ISBN
čárovým kódem nebo ručně, doplní údaje z veřejného katalogu **Knihovny.cz**
a hotový fond vyexportuje do **Excelu**.

Běží celá v prohlížeči – žádný server, žádný API klíč, žádná databáze.
Data jsou uložená v `localStorage` zařízení.

## Co umí

| Funkce | Jak to funguje |
|---|---|
| Skenování čárového kódu | `BarcodeDetector` (rychle na Androidu), fallback `@zxing/library` (iOS, desktop) |
| Inverzní kódy | snímky se střídavě dekódují normální i převrácené (bílé pruhy na černém) |
| Čtení tištěných číslic | režim „Číslice (OCR)“ – tesseract.js se načte až při použití |
| Ruční zadání čísla | bez kamery, dotaz do katalogu |
| Ruční vyplnění celé knihy | formulář, volitelně s dohledáním podle ISBN |
| Doplňování z katalogu | `lookfor` = ISBN / název / autor / „vše“ (`AllFields`) |
| Ochrana proti záměně vydání | dotaz `limit=10`, vybírá se záznam, jehož `isbns` obsahuje hledané ISBN |
| Duplicity | kontrola podle ISBN-13 před uložením |
| Přírůstková čísla | prefix + rostoucí číslo + doplnění nulami |
| Export | `.xlsx` (16 sloupců, hlavička, filtr, zamrzlý první řádek) a `.csv` s BOM |
| Záloha | JSON s celým fondem (export i obnova) |
| Offline | service worker cachuje aplikaci; seznam knih je v zařízení |

## Rychlý start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 60 jednotkových testů (katalog se testuje proti ukázkové odpovědi)
npm run typecheck
npm run build        # dist/ – statické soubory
npm run preview      # náhled produkčního buildu
```

Kamera vyžaduje **secure context**: `https://` nebo `localhost`. Přes `http://`
na LAN adrese ji prohlížeč nepovolí (aplikace to řekne a nabídne ruční zadání).

## Nasazení na GitHub Pages

1. Vytvořte repozitář a nahrajte obsah této složky.
2. V *Settings → Pages* nastavte **Source: GitHub Actions**.
3. Push do `main` spustí `.github/workflows/deploy.yml` – build a publikaci.
4. Aplikace poběží na `https://<uživatel>.github.io/<repo>/`.

`vite.config.ts` má `base: './'` a routing jde přes hash (`#/scan`, `#/list`),
takže funguje v podadresáři bez dalšího nastavení.

Na Androidu v Chrome lze aplikaci **nainstalovat na plochu** (Nabídka → Přidat na
plochu). Pak se otevírá na celou obrazovku a funguje i bez signálu.

## Struktura

```text
index.html              jediná stránka
src/
  core/
    isbn.ts             validace, ISBN-10 → 13, vytahování ISBN z textu
    catalog.ts          klient API katalogu (URLSearchParams, 8s limit)
    record.ts           mapování záznamu → kniha (ořez interpunkce, roky, strany)
    store.ts            úložiště knih a nastavení, přírůstková čísla
    xlsx.ts             zápis .xlsx (ZIP + XML, bez SheetJS)
    export.ts           sloupce, XLSX, CSV s BOM, sdílení souboru
    scan/
      camera.ts         getUserMedia, svítilna, zoom, chybové hlášky
      engine.ts         dekódovací smyčka: BarcodeDetector → ZXing → inverze
      ocr.ts            tesseract.js (lazy), příprava výřezu číslic
  app/library.ts        spojení katalogu a úložiště pro UI (lookup, save)
  ui/                   obrazovky: sken, seznam, detail, hledání, nastavení
  styles/app.css        mobilní tmavé téma
public/                 manifest, ikony, service worker
scripts/
  make-icons.mjs        generování PNG ikon (node scripts/make-icons.mjs)
  e2e-check.mjs         test běžící aplikace v Edge (playwright-core)
scan-check.html         ruční kontrola dekodéru (jen pro vývoj)
```

## Katalog Knihovny.cz

`GET https://www.knihovny.cz/api/v1/search` – CORS povolený, volá se přímo
z prohlížeče, bez hlaviček.

- `lookfor` hledaný text, `type` = `ISN | Title | Author | AllFields | adv_search_nbn`,
  `limit` 0–100, `field[]` se opakuje pro každé pole (bez něj nepřijde nakladatel,
  rok, ISBN ani ČNB).
- ISBN se **vždy posílá jako 13 číslic bez pomlček** – desetimístné ISBN novější
  knihu nenajde.
- Nenalezeno = HTTP 200, `resultCount: 0` a **chybějící** klíč `records`, proto
  se čte jako `data.records ?? []`.
- Autoři přicházejí jako klíče objektu („Jméno Příjmení, roky“), `primary` = autor,
  `secondary` = překladatel/ilustrátor.
- Časový limit dotazu je 8 s (`AbortController`); chyby se v UI rozliší na
  „neodpovídá“, „nedostupný“ a „nic nenalezeno“.

## Testy

```bash
npm test                        # jednotkové testy, bez sítě
node scripts/e2e-check.mjs      # aplikace v Edge (vyžaduje běžící npm run dev)
node scripts/make-icons.mjs     # přegenerování ikon
```

`scripts/e2e-check.mjs` **nevolá živý katalog** – pustí jen localhost a každý jiný
požadavek nahradí ukázkovou odpovědí, takže se testuje zpracování dat, ne síť.
Ověřuje dekódování EAN-13 (běžné i inverzní), přidání knihy, práci s odpovědí
katalogu, různá přírůstková čísla a export do Excelu.

Export byl ověřen i mimo prohlížeč (`openpyxl`): hlavička, diakritika, čísla jako
čísla, zamrzlá hlavička a autofiltr.

## Omezení a poznámky

- **OCR** (tesseract.js) se stahuje z CDN až při prvním použití; bez sítě se
  nenačte a aplikace nabídne ruční zadání. Pro offline provoz lze knihovnu
  a jazykový model nakopírovat do `public/` a upravit cesty v `src/core/scan/ocr.ts`.
- **Svítilnu a zoom** nabízí jen prohlížeč, který je umí ovládat
  (`getCapabilities`); tlačítko se jindy vůbec nezobrazí.
- **Knihy bez ISBN** (staré tisky) jdou uložit – jen se nenajdou v katalogu.
- Data jsou v zařízení, ne v cloudu: přenos mezi telefony je přes zálohu (JSON).
- `localStorage` unese tisíce knih; při zaplnění aplikace upozorní v nastavení.
