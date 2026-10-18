// Y-axis labels grow with the formatted amount, not the stored integer.
// "$10,000" and "¥10,000" need the wider margin; "$1,000" does not.
const WIDE_LABEL_LENGTH = 7;

export function chartAxisMargin(
  amount: number,
  formatLabel: (value: number) => string,
  wideMargin: number,
  narrowMargin = 0,
): number {
  const label = formatLabel(Math.abs(amount)).replace(
    /[\u202A\u202C\u202F]/g,
    '',
  );
  return label.length >= WIDE_LABEL_LENGTH ? wideMargin : narrowMargin;
}
