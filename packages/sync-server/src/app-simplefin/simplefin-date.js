// Unix seconds for a SimpleFIN start or end. A date-only value is UTC
// midnight, and that instant is the calendar day the user asked for.
// A local clock time (the default month bounds) is sent as the same
// clock face in UTC; shifting UTC midnight by the server timezone would
// move the requested day.
export function simplefinUnixSeconds(date) {
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return date.getTime() / 1000;
  }
  return (date.valueOf() - date.getTimezoneOffset() * 60 * 1000) / 1000;
}
