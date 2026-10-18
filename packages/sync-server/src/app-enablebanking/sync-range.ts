// The latest booking date to request. UTC "today" is still yesterday during
// the morning in timezones ahead of UTC, so the end is the next UTC date.
// That date is always today or tomorrow locally, and never yesterday.
export function syncRangeEnd(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
