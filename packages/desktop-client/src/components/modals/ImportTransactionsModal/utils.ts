import { format as formatDate_ } from '@actual-app/core/shared/months';

export {
  applyFieldMappings,
  dateFormats,
  filterByStartDate,
  getFileType,
  getInitialDateFormat,
  getInitialMappings,
  isDateFormat,
  parseAmountFields,
  parseCategoryFields,
  parseDate,
  stripCsvImportTransaction,
} from '@actual-app/core/shared/import-mapping';
export type {
  DateFormat,
  FieldMapping,
  ImportTransaction,
} from '@actual-app/core/shared/import-mapping';

export function formatDate(
  date: Parameters<typeof formatDate_>[0] | null,
  format: Parameters<typeof formatDate_>[1],
) {
  if (!date) {
    return null;
  }
  try {
    return formatDate_(date, format);
  } catch {}
  return null;
}
