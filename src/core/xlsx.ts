/**
 * Minimalistický zapisovač XLSX.
 *
 * Záměrně bez SheetJS: formát .xlsx je ZIP s pár XML soubory a vlastní writer
 * je menší, čitelný a nezávislý na balíčku s problematickou historií.
 * Buňky zapisujeme jako inline stringy, takže nevzniká sharedStrings tabulka.
 */

import { zipSync, strToU8 } from 'fflate';

export type CellValue = string | number | boolean | null | undefined;

export interface SheetColumn {
  header: string;
  /** Šířka sloupce v Excelu (znaky). */
  width?: number;
  /** Čísla se zapisují jako čísla, aby se s nimi dalo v Excelu počítat. */
  type?: 'text' | 'number';
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
  /** Zamknout hlavičku (výchozí true) a zapnout filtr. */
  freezeHeader?: boolean;
  autoFilter?: boolean;
  /** Titulek nad tabulkou – vypne se kvůli jednoduchému formátu. */
}

/** XML escapování textu i atributů. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Znaky, které XML 1.0 neumí (řídící znaky z OCR) – jinak Excel soubor odmítne.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** 1 → A, 26 → Z, 27 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Název listu podle pravidel Excelu (max 31 znaků, bez []:*?/\). */
export function sanitizeSheetName(name: string): string {
  const clean = (name || 'List').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return clean || 'List';
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function cellXml(ref: string, value: CellValue, styleIndex: number): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleIndex}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b" s="${styleIndex}"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = escapeXml(String(value));
  if (!text) return '';
  return `<c r="${ref}" t="inlineStr" s="${styleIndex}"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(spec: SheetSpec): string {
  const columns = spec.columns;
  const lastCol = columnLetter(Math.max(columns.length, 1));
  const rowCount = spec.rows.length + 1;

  const cols = columns
    .map((col, i) => {
      const width = col.width ?? Math.min(48, Math.max(12, col.header.length + 4));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const headerRow =
    '<row r="1" ht="22" customHeight="1">' +
    columns.map((col, i) => cellXml(`${columnLetter(i + 1)}1`, col.header, 1)).join('') +
    '</row>';

  const bodyRows = spec.rows
    .map((row, r) => {
      const rowNumber = r + 2;
      const cells = row
        .map((value, i) => {
          if (value === null || value === undefined) return '';
          const isNumber = columns[i]?.type === 'number' && typeof value === 'number';
          return cellXml(
            `${columnLetter(i + 1)}${rowNumber}`,
            isNumber ? value : typeof value === 'number' ? String(value) : value,
            0,
          );
        })
        .join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join('');

  const freezeHeader = spec.freezeHeader !== false;
  const sheetViews =
    '<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
    (freezeHeader
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
      : '') +
    '</sheetView></sheetViews>';

  const autoFilter =
    spec.autoFilter !== false && columns.length > 0
      ? `<autoFilter ref="A1:${lastCol}${rowCount}"/>`
      : '';

  return (
    XML_HEADER +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${lastCol}${rowCount}"/>` +
    sheetViews +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${headerRow}${bodyRows}</sheetData>` +
    autoFilter +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '</worksheet>'
  );
}

/** Styly: 0 = běžná buňka, 1 = hlavička (tučné, podbarvené, orámované). */
const STYLES_XML =
  XML_HEADER +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border>' +
  '<left style="thin"><color rgb="FFD0D7E5"/></left>' +
  '<right style="thin"><color rgb="FFD0D7E5"/></right>' +
  '<top style="thin"><color rgb="FFD0D7E5"/></top>' +
  '<bottom style="thin"><color rgb="FFD0D7E5"/></bottom>' +
  '<diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
  '<alignment vertical="center" wrapText="0"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" ' +
  'applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Sestaví obsah .xlsx jako bajty. */
export function buildXlsx(spec: SheetSpec): Uint8Array {
  const sheetName = sanitizeSheetName(spec.name);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      XML_HEADER +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '</Relationships>',
    ),
    'docProps/core.xml': strToU8(
      XML_HEADER +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:creator>Skener knihovny</dc:creator>' +
        '<cp:lastModifiedBy>Skener knihovny</cp:lastModifiedBy>' +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>` +
        '</cp:coreProperties>',
    ),
    'docProps/app.xml': strToU8(
      XML_HEADER +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
        '<Application>Skener knihovny</Application>' +
        '</Properties>',
    ),
    'xl/workbook.xml': strToU8(
      XML_HEADER +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      XML_HEADER +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(STYLES_XML),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(spec)),
  };

  return zipSync(files, { level: 6 });
}
