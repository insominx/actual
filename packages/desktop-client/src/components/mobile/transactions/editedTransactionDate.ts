import * as monthUtils from '@actual-app/core/shared/months';
import { isValid, parse } from 'date-fns';

// Same floor as the budget engine. A year check of "> 2000" dropped real
// transactions from 1995 through 2000, while still being what rejects a
// truncated year such as 201.
const MINIMUM_TRANSACTION_DATE = '1995-01-01';

export function parseEditedTransactionDate(
  value: string,
  dateFormat: string,
): string | null {
  const dayMonth = monthUtils.getDayMonthRegex(dateFormat);
  if (dayMonth.test(value)) {
    const test = parse(
      value,
      monthUtils.getDayMonthFormat(dateFormat),
      new Date(),
    );
    return isValid(test) ? monthUtils.dayFromDate(test) : null;
  }

  const test = parse(value, dateFormat, new Date());
  if (!isValid(test)) {
    return null;
  }
  const day = monthUtils.dayFromDate(test);
  if (day < MINIMUM_TRANSACTION_DATE) {
    return null;
  }
  return day;
}
