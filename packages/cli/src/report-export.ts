// Export helpers for `reports` commands. Amounts stay integer cents in every
// export; a decimal column is added next to each cents column for humans.

export type ExportFormat = 'csv' | 'html';

export type ExportTable = {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
};

export type ExportDocument = {
  title: string;
  meta: Array<[string, string]>;
  tables: ExportTable[];
};

const FORMULA_START = /^[=+\-@\t\r]/;
// A plain signed decimal (such as centsToDecimal output) is data, not a formula.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Decimal rendering of integer cents without floating point drift. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * One CSV cell. Text that a spreadsheet could evaluate as a formula is
 * prefixed with an apostrophe; numbers are written as-is.
 */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text =
    FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)
      ? `'${value}`
      : value;
  return /[",\r\n]/.test(text) || text !== value
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toCsv(doc: ExportDocument): string {
  const lines: string[] = [];
  for (const [key, value] of doc.meta) {
    lines.push([csvCell(key), csvCell(value)].join(','));
  }
  for (const table of doc.tables) {
    lines.push('');
    lines.push(csvCell(table.title));
    lines.push(table.columns.map(csvCell).join(','));
    for (const row of table.rows) lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function toHtml(doc: ExportDocument): string {
  const cell = (value: string | number | boolean | null) =>
    value === null ? '' : escapeHtml(String(value));
  const meta = doc.meta
    .map(([k, v]) => `<tr><th>${cell(k)}</th><td>${cell(v)}</td></tr>`)
    .join('\n');
  const tables = doc.tables
    .map(
      table =>
        `<h2>${cell(table.title)}</h2>\n<table>\n<thead><tr>${table.columns
          .map(c => `<th>${cell(c)}</th>`)
          .join('')}</tr></thead>\n<tbody>\n${table.rows
          .map(
            row => `<tr>${row.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`,
          )
          .join('\n')}\n</tbody>\n</table>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${cell(doc.title)}</title>
<style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse;margin-bottom:2em}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}</style>
</head>
<body>
<h1>${cell(doc.title)}</h1>
<table class="meta">
${meta}
</table>
${tables}
</body>
</html>
`;
}
