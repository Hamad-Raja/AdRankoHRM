'use strict';

const JSZip = require('jszip');
const ApiError = require('./ApiError');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const MAX_XML_BYTES = 64 * 1024 * 1024;

function validText(value) {
  const text = String(value);

  if (
    text.length > 32767 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text)
  ) {
    throw new ApiError(
      422,
      'Export text exceeds spreadsheet limits or contains unsupported control characters.',
      'EXPORT_TEXT_INVALID'
    );
  }

  for (const char of text) {
    const code = char.codePointAt(0);

    if (code >= 0xd800 && code <= 0xdfff) {
      throw new ApiError(
        422,
        'Export text contains invalid Unicode.',
        'EXPORT_TEXT_INVALID'
      );
    }
  }

  return text;
}

function escapeXML(value) {
  return validText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;');
}

function spreadsheetText(value) {
  // Escape only the lead underscore, including overlapping sequences.
  const text = String(value)
    .replace(/_(?=x[0-9a-fA-F]{4}_)/g, '_x005F_')
    .replace(/\r/g, '_x000D_');

  return escapeXML(text);
}

function columnName(number) {
  let name = '';

  for (
    let value = number;
    value > 0;
    value = Math.floor((value - 1) / 26)
  ) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }

  return name;
}

function cell(value, reference, header) {
  if (value == null) {
    return `<c r="${reference}"/>`;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ApiError(
        422,
        'Export contains an invalid number.',
        'EXPORT_VALUE_INVALID'
      );
    }

    return `<c r="${reference}" s="2" t="n"><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${Number(value)}</v></c>`;
  }

  return `<c r="${reference}" s="${header ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${spreadsheetText(value)}</t></is></c>`;
}

function worksheet(sheet) {
  const columns = sheet.headers.length;
  const lines = [];
  let bytes = 0;

  for (const [index, values] of [sheet.headers, ...sheet.rows].entries()) {
    const line =
      `<row r="${index + 1}"${index === 0 ? ' ht="32" customHeight="1"' : ''}>` +
      values
        .map((value, column) =>
          cell(
            value,
            `${columnName(column + 1)}${index + 1}`,
            index === 0
          )
        )
        .join('') +
      '</row>';

    bytes += Buffer.byteLength(line, 'utf8');

    if (bytes > MAX_XML_BYTES) {
      throw new ApiError(
        413,
        'Workbook is too large. Narrow the report filters.',
        'EXPORT_TOO_LARGE'
      );
    }

    lines.push(line);
  }

  const lastCell = `${columnName(columns)}${sheet.rows.length + 1}`;

  return (
    XML +
    `<worksheet xmlns="${MAIN}">` +
    `<dimension ref="A1:${lastCell}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    '<cols>' +
    sheet.headers
      .map((header, index) => {
        const width =
          sheet.name === 'Metadata' && index === 1
            ? 100
            : /reason|name|organization/i.test(header)
              ? 32
              : 23;

        return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
      })
      .join('') +
    '</cols>' +
    `<sheetData>${lines.join('')}</sheetData>` +
    `<autoFilter ref="A1:${lastCell}"/>` +
    '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
    '</worksheet>'
  );
}

const styles =
  XML +
  `<styleSheet xmlns="${MAIN}">` +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF065F46"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

async function makeWorkbook(sheets, generatedAt) {
  const zip = new JSZip();
  let size = 0;

  const add = (name, value) => {
    size += Buffer.byteLength(value, 'utf8');

    if (size > MAX_XML_BYTES) {
      throw new ApiError(
        413,
        'Workbook is too large. Narrow the report filters.',
        'EXPORT_TOO_LARGE'
      );
    }

    zip.file(name, value, {
      date: new Date(generatedAt),
      createFolders: false,
    });
  };

  add(
    '[Content_Types].xml',
    XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      sheets
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '</Types>'
  );

  add(
    '_rels/.rels',
    XML +
      `<Relationships xmlns="${PACKAGE_REL}">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>'
  );

  add(
    'docProps/core.xml',
    XML +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:creator>AdRankoHRM</dc:creator>' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXML(generatedAt)}</dcterms:created>` +
      '</cp:coreProperties>'
  );

  add(
    'xl/workbook.xml',
    XML +
      `<workbook xmlns="${MAIN}" xmlns:r="${REL}">` +
      '<bookViews><workbookView/></bookViews><sheets>' +
      sheets
        .map(
          (sheet, index) =>
            `<sheet name="${escapeXML(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
        )
        .join('') +
      '</sheets></workbook>'
  );

  add(
    'xl/_rels/workbook.xml.rels',
    XML +
      `<Relationships xmlns="${PACKAGE_REL}">` +
      sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
      '</Relationships>'
  );

  add('xl/styles.xml', styles);

  for (let index = 0; index < sheets.length; index++) {
    add(
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheet(sheets[index])
    );
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

module.exports = { makeWorkbook, validText };