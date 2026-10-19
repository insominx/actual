// @ts-strict-ignore
import { parse as csv2json } from 'csv-parse/sync';

import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import { looselyParseAmount } from '#shared/util';

import { ofx2json } from './ofx2json';
import { qif2json } from './qif2json';
import { xmlCAMT2json } from './xmlcamt2json';

/**
 * Parse OFX amount strings to numbers.
 * Handles various OFX amount formats including currency symbols, parentheses, and multiple decimal places.
 * Returns null for invalid amounts instead of NaN.
 */
export function parseOfxAmount(amount: string): number | null {
  if (!amount || typeof amount !== 'string') {
    return null;
  }

  // Handle parentheses for negative amounts (e.g., "(30.00)" -> "-30.00").
  // A trailing minus (`12,50-`) has to be removed before the comma-decimal
  // check, which only looks at the end of the string.
  let cleaned = amount.trim().replace(/\u2212/g, '-');
  let trailingNegative = false;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  } else if (cleaned.endsWith('-') && !cleaned.startsWith('-')) {
    trailingNegative = true;
    cleaned = cleaned.slice(0, -1).trimEnd();
  }

  // A comma is the decimal mark when it is the last separator and only
  // 1-2 digits follow (`12,50`, `1.234,56`). A period in that role is the
  // decimal mark and commas are thousands (`1,234.56`). A comma followed
  // by 3 digits (`1,234`) stays a thousands separator.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot && /,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && /\.\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (lastDot === -1) {
    cleaned = cleaned.replace(/,(\d{1,2})$/, '.$1');
  }

  // Remove currency symbols and other non-numeric characters except decimal point and minus sign
  cleaned = cleaned.replace(/[^\d.-]/g, '');

  // Handle multiple decimal points by keeping only the first one
  const decimalIndex = cleaned.indexOf('.');
  if (decimalIndex !== -1) {
    const beforeDecimal = cleaned.slice(0, decimalIndex);
    const afterDecimal = cleaned.slice(decimalIndex + 1).replace(/\./g, '');
    cleaned = beforeDecimal + '.' + afterDecimal;
  }

  // Ensure we have a valid number format
  if (!cleaned || cleaned === '-' || cleaned === '.') {
    return null;
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    return null;
  }
  return trailingNegative ? -parsed : parsed;
}

type StructuredTransaction = {
  amount: number;
  imported_id?: string;
  date: string;
  payee_name: string;
  imported_payee: string;
  notes: string;
  category?: string | null;
};

// `split` on a file that ends with a newline yields a final empty string.
// That phantom line is not a row, and counting it made "skip the last line"
// drop the blank instead of the footer.
export function csvLinesWithoutTrailingBlank(contents: string): string[] {
  const lines = contents.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Decode raw CSV file bytes into a string. A user-provided encoding always
 * wins; otherwise the byte order mark selects UTF-16 LE/BE and everything
 * else decodes as UTF-8. Files in other encodings can be selected manually
 * in the import dialog.
 */
function decodeCsvBytes(bytes: Uint8Array, encoding = 'auto'): string {
  if (encoding !== 'auto') {
    // Per the WHATWG encoding spec, the iso-8859-1 label resolves to the
    // windows-1252 decoder; no browser provides a true ISO-8859-1 decoder,
    // and windows-1252 gives better results for legacy CSV content anyway.
    return new TextDecoder(encoding).decode(bytes);
  }

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  return new TextDecoder('utf-8').decode(bytes);
}

// CSV files return raw data that are not guaranteed to be StructuredTransactions
type CsvTransaction = Record<string, string> | string[];

type Transaction = StructuredTransaction | CsvTransaction;

type ParseError = { message: string; internal: string };
export type ParseFileResult = {
  errors: ParseError[];
  transactions?: Transaction[];
};

export type ParseFileOptions = {
  hasHeaderRow?: boolean;
  delimiter?: string;
  fallbackMissingPayeeToMemo?: boolean;
  swapPayeeAndMemo?: boolean;
  skipStartLines?: number;
  skipEndLines?: number;
  importNotes?: boolean;
  encoding?: string;
};

export async function parseFile(
  filepath: string,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();
  const m = filepath.match(/\.[^.]*$/);

  if (m) {
    const ext = m[0];

    switch (ext.toLowerCase()) {
      case '.qif':
        return parseQIF(filepath, options);
      case '.csv':
      case '.tsv':
        return parseCSV(filepath, options);
      case '.ofx':
      case '.qfx':
        return parseOFX(filepath, options);
      case '.xml':
        return parseCAMT(filepath, options);
      default:
    }
  }

  errors.push({
    message: 'Invalid file type',
    internal: '',
  });
  return { errors, transactions: [] };
}

async function parseCSV(
  filepath: string,
  options: ParseFileOptions,
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();
  const bytes = await fs.readFile(filepath, 'binary');

  let contents: string;
  try {
    contents = decodeCsvBytes(bytes, options.encoding);
  } catch (err) {
    errors.push({
      message: 'Failed parsing: ' + err.message,
      internal: err.message,
    });
    return { errors, transactions: [] };
  }

  const skipStart = Math.max(0, options.skipStartLines || 0);
  const skipEnd = Math.max(0, options.skipEndLines || 0);

  if (skipStart > 0 || skipEnd > 0) {
    const lines = csvLinesWithoutTrailingBlank(contents);

    if (skipStart + skipEnd >= lines.length) {
      errors.push({
        message: 'Cannot skip more lines than exist in the file',
        internal: `Attempted to skip ${skipStart} start + ${skipEnd} end lines from ${lines.length} total lines`,
      });
      return { errors, transactions: [] };
    }

    const startLine = skipStart;
    const endLine = skipEnd > 0 ? lines.length - skipEnd : lines.length;
    contents = lines.slice(startLine, endLine).join('\r\n');
  }

  let data: ReturnType<typeof csv2json>;
  try {
    data = csv2json(contents, {
      columns: options?.hasHeaderRow,
      bom: true,
      delimiter: options?.delimiter || ',',

      quote: '"',
      trim: true,
      relax_column_count: true,
      skip_empty_lines: true,
    });
  } catch (err) {
    errors.push({
      message: 'Failed parsing: ' + err.message,
      internal: err.message,
    });
    return { errors, transactions: [] };
  }

  return { errors, transactions: data };
}

async function parseQIF(
  filepath: string,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();
  const contents = await fs.readFile(filepath);

  let data: ReturnType<typeof qif2json>;
  try {
    data = qif2json(contents);
  } catch (err) {
    errors.push({
      message: "Failed parsing: doesn't look like a valid QIF file.",
      internal: err.stack,
    });
    return { errors, transactions: [] };
  }

  const swap = options.swapPayeeAndMemo;

  return {
    errors: [],
    transactions: data.transactions
      .map(trans => {
        const payeeSource = swap ? trans.memo : trans.payee;
        const memoSource = swap ? trans.payee : trans.memo;
        const fallbackUsed = !payeeSource && swap;

        return {
          amount:
            trans.amount != null ? looselyParseAmount(trans.amount) : null,
          date: trans.date,
          payee_name: payeeSource || (fallbackUsed ? memoSource : null),
          imported_payee: payeeSource || (fallbackUsed ? memoSource : null),
          category: trans.subcategory || trans.category || null,
          notes:
            options.importNotes && !fallbackUsed ? memoSource || null : null,
        };
      })
      .filter(trans => trans.date != null && trans.amount != null),
  };
}

async function parseOFX(
  filepath: string,
  options: ParseFileOptions,
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();
  const contents = await fs.readFile(filepath, 'binary');

  let data: Awaited<ReturnType<typeof ofx2json>>;
  try {
    data = await ofx2json(contents);
  } catch (err) {
    errors.push({
      message: 'Failed importing file',
      internal: err.stack,
    });
    return { errors };
  }

  // Banks don't always implement the OFX standard properly
  // If no payee is available try and fallback to memo
  const useMemoFallback = options.fallbackMissingPayeeToMemo;
  const swap = options.swapPayeeAndMemo;

  const transactions: StructuredTransaction[] = [];
  for (const trans of data.transactions) {
    if (trans.date == null) {
      errors.push({
        message: 'Transaction is missing a posted date',
        internal: `Missing DTPOSTED for FITID ${trans.fitId}`,
      });
      continue;
    }

    const parsedAmount = parseOfxAmount(trans.amount);
    if (parsedAmount === null) {
      errors.push({
        message: `Invalid amount format: ${trans.amount}`,
        internal: `Failed to parse amount: ${trans.amount}`,
      });
      continue;
    }

    const payeeSource = swap ? trans.memo : trans.name;
    const memoSource = swap ? trans.name : trans.memo;
    const fallbackUsed = !payeeSource && useMemoFallback;

    transactions.push({
      amount: parsedAmount,
      imported_id: trans.fitId,
      date: trans.date,
      payee_name: payeeSource || (fallbackUsed ? memoSource : null),
      imported_payee: payeeSource || (fallbackUsed ? memoSource : null),
      notes: options.importNotes && !fallbackUsed ? memoSource || null : null,
    });
  }

  return { errors, transactions };
}

async function parseCAMT(
  filepath: string,
  options: ParseFileOptions = {},
): Promise<ParseFileResult> {
  const errors = Array<ParseError>();
  // Read the raw bytes so xmlCAMT2json can honor the encoding declared in
  // the XML header instead of decoding the file as UTF-8.
  const contents = await fs.readFile(filepath, 'binary');

  let data: Awaited<ReturnType<typeof xmlCAMT2json>>;
  try {
    data = await xmlCAMT2json(contents);
  } catch (err) {
    logger.error(err);
    errors.push({
      message: 'Failed importing file',
      internal: err.stack,
    });
    return { errors };
  }

  const swap = options.swapPayeeAndMemo;

  return {
    errors,
    transactions: data.map(trans => {
      const payeeSource = swap ? trans.notes : trans.payee_name;
      const memoSource = swap ? trans.payee_name : trans.notes;
      const fallbackUsed = !payeeSource && swap;

      return {
        ...trans,
        payee_name: payeeSource || (fallbackUsed ? memoSource : null),
        imported_payee: payeeSource || (fallbackUsed ? memoSource : null),
        notes: options.importNotes && !fallbackUsed ? memoSource || null : null,
      };
    }),
  };
}
