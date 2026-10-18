// @ts-strict-ignore
import { parseStringPromise } from 'xml2js';

type DateRef = { DtTm: string } | { Dt: string };
type Amt = { _: string };

type Ntry = {
  AcctSvcrRef?: string;
  Amt?: Amt;
  CdtDbtInd: 'CRDT' | 'DBIT';
  ValDt?: DateRef;
  BookgDt?: DateRef;
  NtryDtls?: NtryDtls;
  AddtlNtryInf?: string;
  NtryRef?: string;
};

type NtryDtls = {
  TxDtls: TxDtls | TxDtls[];
};

type TxDtls = {
  CdtDbtInd?: 'CRDT' | 'DBIT';
  RltdPties?: {
    Cdtr: {
      Nm: string;
    };
    Dbtr: {
      Nm: string;
    };
  };
  RmtInf?: {
    Ustrd: string | string[];
  };
};

type TransactionCAMT = {
  amount: number;
  date: string;
  payee_name: string | null;
  imported_payee: string | null;
  notes: string | null;
  imported_id?: string;
};

function findKeys(obj: object, key: string): unknown[] {
  let result = [];
  for (const i in obj) {
    if (!obj.hasOwnProperty(i)) continue;
    if (i === key) {
      if (Array.isArray(obj[i])) {
        result = result.concat(obj[i]);
      } else {
        result.push(obj[i]);
      }
    }
    if (typeof obj[i] === 'object') {
      result = result.concat(findKeys(obj[i], key));
    }
  }
  return result;
}

// xml2js stores an element that has attributes as `{ _: text }`. A note or
// payee name in that shape is not a string, and saving it shows
// "[object Object]".
function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(readText)
      .filter((part): part is string => part != null);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (value && typeof value === 'object' && '_' in value) {
    return readText((value as { _: unknown })._);
  }
  return null;
}

function getPayeeNameFromTxDtls(
  TxDtls: TxDtls,
  isDebit: boolean,
): string | null {
  if (TxDtls?.RltdPties) {
    const key = isDebit ? TxDtls.RltdPties.Cdtr : TxDtls.RltdPties.Dbtr;
    const Nm = findKeys(key, 'Nm');
    return Nm.length > 0 ? readText(Nm[0]) : null;
  }
  return null;
}

function getNotesFromTxDtls(TxDtls: TxDtls): string | null {
  if (TxDtls?.RmtInf) {
    return readText(TxDtls.RmtInf.Ustrd);
  }
  return null;
}

function convertToNumberOrNull(value: string): number | null {
  const number = Number(value);
  return isNaN(number) ? null : number;
}

// xml2js keeps an element with attributes as `{ _: text }`. An amount with
// no currency attribute is the text itself, and reading `._` on that string
// drops the transaction.
function readAmount(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? readAmount(value[0]) : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return convertToNumberOrNull(String(value));
  }
  if (value && typeof value === 'object' && '_' in value) {
    const text = (value as { _: unknown })._;
    if (typeof text === 'string' || typeof text === 'number') {
      return convertToNumberOrNull(String(text));
    }
  }
  return null;
}

// Negating a null amount yields -0, which would slip past the null filter
// at the end of xmlCAMT2json
// A batch entry is one debit or credit overall, but a detail row can be
// the other way (a refund inside a debit batch). The row's own indicator
// wins; rows that omit it keep the entry's.
function detailIsDebit(tx: TxDtls, entryIsDebit: boolean): boolean {
  if (tx?.CdtDbtInd === 'DBIT') {
    return true;
  }
  if (tx?.CdtDbtInd === 'CRDT') {
    return false;
  }
  return entryIsDebit;
}

function signAmount(amount: number | null, isDebit: boolean): number | null {
  if (amount == null) {
    return null;
  }
  return isDebit ? -amount : amount;
}

function getDtOrDtTm(Date: DateRef | null): string | null {
  if (!Date) {
    return null;
  }
  if ('DtTm' in Date) {
    return Date.DtTm.slice(0, 10);
  }
  return Date?.Dt;
}

function decodeXmlContent(content: Uint8Array): string {
  const utf8Decoder = new TextDecoder('utf-8');

  // The XML declaration (up to the first `>`) is ASCII, so it can be
  // inspected to find the declared encoding before decoding the rest of
  // the document. Decoding the header as latin1 keeps the raw byte
  // values, which is correct for the ASCII-only declaration.
  const header = new TextDecoder('latin1').decode(content.subarray(0, 500));
  const match = header.match(/encoding\s*=\s*["']([^"']+)["']/i);
  const declaredEncoding = match?.[1];

  if (declaredEncoding && !/^utf-?8$/i.test(declaredEncoding)) {
    try {
      return new TextDecoder(declaredEncoding).decode(content);
    } catch {
      // Unsupported or unknown encoding label; fall back to UTF-8.
    }
  }

  return utf8Decoder.decode(content);
}

export async function xmlCAMT2json(
  content: string | Uint8Array,
): Promise<TransactionCAMT[]> {
  const data = await parseStringPromise(
    content instanceof Uint8Array ? decodeXmlContent(content) : content,
    { explicitArray: false },
  );
  const entries = findKeys(data, 'Ntry') as Ntry[];

  const transactions: TransactionCAMT[] = [];

  for (const entry of entries) {
    /*
      For (camt.052/054) could filter on entry.Sts= BOOK or PDNG, currently importing all entries
    */

    const id = entry.AcctSvcrRef;

    const amount = readAmount(entry.Amt);
    const isDebit = entry.CdtDbtInd === 'DBIT';

    // The booking date is when the entry hit the account. The value date can
    // fall in another month, which would budget the transaction in the wrong
    // one. Use the value date only when the bank omitted the booking date.
    const date = getDtOrDtTm(entry.BookgDt) || getDtOrDtTm(entry.ValDt);

    const details = Array.isArray(entry.NtryDtls?.TxDtls)
      ? entry.NtryDtls.TxDtls
      : null;
    const detailed = details?.map(tx => {
      const amounts = findKeys(tx, 'Amt') as Amt[];
      return {
        tx,
        amount: amounts.length > 0 ? readAmount(amounts[0]) : null,
      };
    });
    // Several detail rows often carry only the payee. Their amounts live on
    // the entry. Importing each detail with a missing amount dropped the
    // booking. Use the detail amounts when they exist; otherwise import the
    // entry once.
    if (detailed?.some(item => item.amount != null)) {
      for (const item of detailed) {
        if (item.amount == null) {
          continue;
        }
        const itemIsDebit = detailIsDebit(item.tx, isDebit);
        const subPayee = getPayeeNameFromTxDtls(item.tx, itemIsDebit);
        const subNotes = getNotesFromTxDtls(item.tx);
        transactions.push({
          amount: signAmount(item.amount, itemIsDebit),
          date,
          payee_name: subPayee,
          imported_payee: subPayee,
          notes: subNotes,
        });
      }
    } else {
      const detail = details?.[0] ?? entry.NtryDtls?.TxDtls;
      let payee_name: string | null;
      let notes: string | null;
      payee_name = getPayeeNameFromTxDtls(detail, isDebit);
      if (!payee_name && entry.AddtlNtryInf) {
        payee_name = entry.AddtlNtryInf;
      }
      notes = getNotesFromTxDtls(detail);
      if (!notes && entry.AddtlNtryInf && entry.AddtlNtryInf !== payee_name) {
        notes = entry.AddtlNtryInf;
      }
      if (!payee_name && !notes && entry.NtryRef) {
        notes = entry.NtryRef;
      }
      if (payee_name && notes && payee_name.includes(notes)) {
        notes = null;
      }

      const transaction: TransactionCAMT = {
        amount: signAmount(amount, isDebit),
        date,
        payee_name,
        imported_payee: payee_name,
        notes,
      };
      if (id) {
        transaction.imported_id = id;
      }
      transactions.push(transaction);
    }
  }
  return transactions.filter(
    trans => trans.date != null && trans.amount != null,
  );
}
