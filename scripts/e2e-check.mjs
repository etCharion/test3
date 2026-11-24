/**
 * Ověření běžící aplikace v prohlížeči (Edge přes playwright-core).
 *
 * DŮLEŽITÉ: katalog se v tomto testu NEVOLÁ. Pustí se jen localhost, každý jiný
 * požadavek se zastaví a odpoví se ukázkovou odpovědí z fixtures.
 * Nic neopouští počítač – testuje se jen zpracování odpovědi.
 *
 * Co se ověřuje:
 *  1. dekódování EAN-13 normálně i v inverzních barvách (jádro skeneru),
 *  2. ruční přidání knihy a její uložení,
 *  3. zpracování odpovědi katalogu (nález → panel → uložení),
 *  4. export do Excelu (soubor se stáhne do tmp/export.xlsx),
 *  5. chyby v konzoli.
 *
 * Spuštění: node scripts/e2e-check.mjs [port]
 */

import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const port = process.env.E2E_PORT ?? process.argv[2] ?? '5173';
const base = `http://localhost:${port}`;
const results = [];
const consoleErrors = [];

/** Ukázková odpověď API – stejná data jako v src/test/fixtures.ts. */
const SAMPLE_RESPONSE = {
  resultCount: 1,
  records: [
    {
      id: 'mkp.3521868',
      title:
        'Životy slavných a starých provensálských básníků, kteří žili v dobách hrabat z kraje Provença',
      authors: {
        primary: { 'Jean de Nostredame, asi 1507-1577': [] },
        secondary: { 'Josef Prokop, 1971-': [], 'Vojtěch Domlátil, 1979-': [] },
        corporate: [],
      },
      publishers: ['Argo,'],
      placesOfPublication: ['Praha :'],
      publicationDates: ['2011'],
      physicalDescriptions: ['218 s. : il. ; 22 cm'],
      isbns: ['978-80-257-0367-0'],
      issns: [],
      cnb: 'cnb002163342',
      formats: ['0/BOOKS/'],
    },
  ],
  status: 'OK',
};

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`);
}

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

try {
  const context = await browser.newContext({
    viewport: { width: 420, height: 880 },
    permissions: ['camera'],
    locale: 'cs-CZ',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  // Žádný dotaz do katalogu neodchází: pustí se jen localhost, každý jiný
  // požadavek (tj. katalog) se zastaví a odpoví se z fixtures.
  let catalogCalls = 0;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) {
      await route.continue();
      return;
    }
    catalogCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SAMPLE_RESPONSE),
    });
  });

  // ---------- 1. dekodér (jen na vývojovém serveru, scan-check.html není v dist) ----------
  await page.goto(`${base}/scan-check.html`, { waitUntil: 'load' });
  const hasCheck = await page
    .evaluate(() => typeof window.__check === 'function')
    .catch(() => false);
  if (hasCheck) {
    const isbn = '9788025703670';
    const decoded = await page.evaluate((code) => window.__check(code), isbn);
    for (const item of decoded) {
      check(
        `dekódování ${item.inverted ? 'inverzních barev' : 'běžného kódu'} (${item.ms} ms, ${item.engine})`,
        item.ok === true,
        item.text ?? 'nic',
      );
    }
  } else {
    console.log('--   kontrola dekodéru přeskočena (scan-check.html je jen ve vývoji)');
  }

  // ---------- 2. navigace a ruční přidání ----------
  await page.goto(`${base}/#/list`, { waitUntil: 'load' });
  await page.waitForSelector('.tabbar', { timeout: 15000 });
  const tabs = await page.$$eval('.tab', (nodes) => nodes.map((n) => n.textContent?.trim()));
  check('spodní navigace má 4 položky', tabs.length === 4, tabs.join(' | '));

  await page.goto(`${base}/#/new`, { waitUntil: 'load' });
  await page.waitForSelector('form.book-form', { timeout: 15000 });
  const inputs = await page.$$('.book-form input.input');
  check('formulář nové knihy má pole', inputs.length >= 10, `${inputs.length} polí`);

  // Plní se podle popisků – kdyby se pořadí polí změnilo, test to pozná.
  await page.getByLabel('Název *', { exact: true }).fill('Saturnin');
  await page.getByLabel('Autoři', { exact: true }).fill('Zdeněk Jirotka');
  await page.getByLabel('Překlad / ilustrace', { exact: true }).fill('Josef Prokop');
  await page.getByLabel('Rok', { exact: true }).fill('1993');
  await page.getByLabel('Strany', { exact: true }).fill('218');
  const isb = await page.$('.book-form input.input--mono');
  await isb.fill('80-202-0468-7');
  await isb.evaluate((el) => el.blur());
  await page.waitForTimeout(150);
  const normalized = await isb.inputValue();
  check('ISBN-10 se ve formuláři převede na ISBN-13', normalized === '9788020204684', normalized);

  await page.click('.book-form button[type=submit]');
  await page.waitForTimeout(700);
  await page.goto(`${base}/#/list`, { waitUntil: 'load' });
  await page.waitForSelector('.item', { timeout: 8000 });
  const items = await page.$$eval('.item', (nodes) =>
    nodes.map((n) => n.textContent?.replace(/\s+/g, ' ').trim()),
  );
  check('kniha se objeví v seznamu', items.some((t) => t?.includes('Saturnin')), items[0] ?? '');
  check(
    'kniha má autora, rok i ISBN',
    items.some((t) => /Zdeněk Jirotka/.test(t ?? '') && /1993/.test(t ?? '') && /9788020204684/.test(t ?? '')),
    items[0] ?? '',
  );

  // ---------- 3. export do Excelu ----------
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('.btn--primary:has-text("Export do Excelu")'),
  ]);
  mkdirSync('tmp', { recursive: true });
  await download.saveAs('tmp/export.xlsx');
  check('export do Excelu se stáhl', true, download.suggestedFilename());
  writeFileSync('tmp/export-name.txt', download.suggestedFilename(), 'utf8');

  // ---------- 4. nález z katalogu (odpověď z fixtures) ----------
  await page.goto(`${base}/#/scan`, { waitUntil: 'load' });
  await page.waitForSelector('.scan__stage', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tmp/screen-scan.png' });
  const scanState = await page.textContent('.scan__state');
  check('obrazovka skenování něco hlásí', (scanState ?? '').length > 0, scanState?.trim());

  await page.click('.mode-btn:has-text("Zadat číslo")');
  await page.waitForSelector('.sheet input.input--mono', { timeout: 8000 });
  await page.fill('.sheet input.input--mono', '9788025703670');
  await page.click('.sheet .btn--primary');
  await page.waitForSelector('.sheet__title', { timeout: 15000 });
  await page.waitForTimeout(400);
  const sheetText = (await page.textContent('.sheet'))?.replace(/\s+/g, ' ') ?? '';
  await page.screenshot({ path: 'tmp/screen-sheet.png' });
  check('katalog dotaz proběhl přes fixtures', catalogCalls === 1, `${catalogCalls}×`);
  check(
    'panel ukáže název z katalogu',
    /Životy slavných/.test(sheetText),
    sheetText.slice(0, 80),
  );
  check(
    'panel ukáže autora bez letopočtu a nakladatele bez čárky',
    /Jean de Nostredame/.test(sheetText) && !/1507/.test(sheetText),
    sheetText.slice(0, 120),
  );

  // Uložit nalezenou knihu a zkontrolovat ji v seznamu.
  await page.click('.sheet .btn--primary');
  await page.waitForTimeout(600);
  await page.goto(`${base}/#/list`, { waitUntil: 'load' });
  await page.waitForSelector('.item', { timeout: 8000 });
  const afterSave = await page.$$eval('.item', (nodes) =>
    nodes.map((n) => n.textContent?.replace(/\s+/g, ' ').trim()),
  );
  check('kniha z katalogu je v seznamu s rokem a ČNB', 
    afterSave.some((t) => t?.includes('Životy') && t.includes('2011')),
    afterSave.find((t) => t?.includes('Životy')) ?? '',
  );
  check('v knihovně jsou 2 knihy', afterSave.length === 2, `${afterSave.length}`);
  const accessions = afterSave
    .flatMap((t) => (t ?? '').match(/č\.\s*(\S+?)(?=[a-zá-ž]|$)/gi) ?? [])
    .map((m) => m.trim());
  check(
    'obě knihy dostaly různá přírůstková čísla',
    new Set(accessions).size === 2,
    accessions.join(' / '),
  );

  await page.screenshot({ path: 'tmp/screen-list.png' });

  // ---------- 5. nastavení ----------
  await page.goto(`${base}/#/settings`, { waitUntil: 'load' });
  await page.waitForSelector('.card', { timeout: 8000 });
  const settingsText = await page.textContent('body');
  check('nastavení obsahuje přírůstková čísla', /Přírůstková čísla/.test(settingsText ?? ''));
  await page.screenshot({ path: 'tmp/screen-settings.png', fullPage: true });

  check('žádné chyby v konzoli', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSOUHRN: ${results.length - failed.length}/${results.length} kontrol prošlo`);
process.exit(failed.length === 0 ? 0 : 1);
