const NZ_TIME_ZONE = 'Pacific/Auckland';

// Start of a yyyy-MM-dd calendar day in New Zealand. Akahu instants are UTC,
// and UTC midnight is already afternoon in Auckland, so using it as the
// start drops the morning of the requested day.
export function nzDayStart(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, date));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NZ_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcMidnight);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(item => item.type === type)?.value);
  const aucklandAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return new Date(
    utcMidnight.getTime() - (aucklandAsUtc - utcMidnight.getTime()),
  );
}
