// Rule conditions run user-written patterns with the JavaScript engine on
// every imported or added transaction. A repeated group that itself repeats,
// such as (a+)+$, backtracks exponentially, so one long note stalls the whole
// process for minutes. This finds that shape. It does not catch every
// pathological pattern (overlapping alternation under a repeat, for example,
// is not detected); it removes the common nested-repeat form.

function repeatAt(
  pattern: string,
  index: number,
): 'none' | 'optional' | 'many' {
  const char = pattern[index];
  if (char === '*' || char === '+') return 'many';
  if (char === '?') return 'optional';
  if (char === '{') {
    const match = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(index));
    if (!match) return 'none';
    const min = Number(match[1]);
    if (match[2] === undefined) return min > 1 ? 'many' : 'none';
    if (match[3] === '') return 'many';
    return Number(match[3]) > 1 ? 'many' : 'optional';
  }
  return 'none';
}

export function hasNestedRepeat(pattern: string): boolean {
  const groups: Array<{ repeats: boolean }> = [{ repeats: false }];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      i++;
    } else if (inClass) {
      if (char === ']') inClass = false;
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      groups.push({ repeats: false });
    } else if (char === ')') {
      if (groups.length > 1) {
        const group = groups.pop()!;
        const outer = repeatAt(pattern, i + 1);
        if (outer === 'many' && group.repeats) return true;
        groups[groups.length - 1].repeats ||= group.repeats || outer === 'many';
      }
    } else if (repeatAt(pattern, i) === 'many') {
      groups[groups.length - 1].repeats = true;
    }
  }
  return false;
}
