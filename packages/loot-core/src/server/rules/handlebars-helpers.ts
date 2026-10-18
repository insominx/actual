import {
  addMonths,
  addWeeks,
  addYears,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns';
import * as Handlebars from 'handlebars';

import { logger } from '#platform/server/log';
import { addDays, format, parseDate, subDays } from '#shared/months';

export function registerHandlebarsHelpers() {
  const regexTest = /^\/(.*)\/([gimuy]*)$/;

  function mathHelper(fn: (a: number, b: number) => number) {
    return (a: unknown, ...b: unknown[]) => {
      return b.map(Number).reduce(fn, Number(a));
    };
  }

  function regexHelper(
    mapRegex: (regex: string, flags: string) => string | RegExp,
    mapNonRegex: (value: string) => string | RegExp,
    apply: (value: string, regex: string | RegExp, replace: string) => string,
  ) {
    return (value: unknown, regex: unknown, replace: unknown) => {
      if (value == null) {
        return null;
      }

      if (typeof regex !== 'string' || typeof replace !== 'string') {
        return '';
      }

      let regexp: string | RegExp;
      const match = regexTest.exec(regex);
      // Regex is in format /regex/flags
      if (match) {
        regexp = mapRegex(match[1], match[2]);
      } else {
        regexp = mapNonRegex(regex);
      }

      return apply(String(value), regexp, replace);
    };
  }

  const helpers = {
    regex: regexHelper(
      (regex, flags) => new RegExp(regex, flags),
      value => new RegExp(value),
      (value, regex, replace) => value.replace(regex, replace),
    ),
    replace: regexHelper(
      (regex, flags) => new RegExp(regex, flags),
      value => value,
      (value, regex, replace) =>
        // A plain string is a literal replacement. `$&` and `$$` stay
        // characters. A `/pattern/` still supports capture groups.
        typeof regex === 'string'
          ? value.replace(regex, () => replace)
          : value.replace(regex, replace),
    ),
    replaceAll: regexHelper(
      (regex, flags) => new RegExp(regex, flags),
      value => value,
      (value, regex, replace) =>
        typeof regex === 'string'
          ? value.replaceAll(regex, () => replace)
          : value.replaceAll(regex, replace),
    ),
    add: mathHelper((a, b) => a + b),
    sub: mathHelper((a, b) => a - b),
    div: mathHelper((a, b) => a / b),
    mul: mathHelper((a, b) => a * b),
    mod: mathHelper((a, b) => a % b),
    floor: (a: unknown) => Math.floor(Number(a)),
    ceil: (a: unknown) => Math.ceil(Number(a)),
    round: (a: unknown) => Math.round(Number(a)),
    abs: (a: unknown) => Math.abs(Number(a)),
    min: mathHelper((a, b) => Math.min(a, b)),
    max: mathHelper((a, b) => Math.max(a, b)),
    fixed: (a: unknown, digits: unknown) => Number(a).toFixed(Number(digits)),
    day: (date?: string) => date && format(date, 'd'),
    month: (date?: string) => date && format(date, 'M'),
    year: (date?: string) => date && format(date, 'yyyy'),
    format: (date?: string, f?: string) => date && f && format(date, f),
    // The amounts may arrive as numeric strings (e.g. from `fixed`), and
    // date-fns would concatenate those instead of adding them
    addDays: (date?: string, days?: number | string) => {
      const amount = Number(days);
      if (!date || !amount) return date;
      return format(addDays(date, amount), 'yyyy-MM-dd');
    },
    subDays: (date?: string, days?: number | string) => {
      const amount = Number(days);
      if (!date || !amount) return date;
      return format(subDays(date, amount), 'yyyy-MM-dd');
    },
    addMonths: (date?: string, months?: number | string) => {
      const amount = Number(months);
      if (!date || !amount) return date;
      return format(addMonths(parseDate(date), amount), 'yyyy-MM-dd');
    },
    subMonths: (date?: string, months?: number | string) => {
      const amount = Number(months);
      if (!date || !amount) return date;
      return format(subMonths(parseDate(date), amount), 'yyyy-MM-dd');
    },
    addWeeks: (date?: string, weeks?: number | string) => {
      const amount = Number(weeks);
      if (!date || !amount) return date;
      return format(addWeeks(parseDate(date), amount), 'yyyy-MM-dd');
    },
    subWeeks: (date?: string, weeks?: number | string) => {
      const amount = Number(weeks);
      if (!date || !amount) return date;
      return format(subWeeks(parseDate(date), amount), 'yyyy-MM-dd');
    },
    addYears: (date?: string, years?: number | string) => {
      const amount = Number(years);
      if (!date || !amount) return date;
      return format(addYears(parseDate(date), amount), 'yyyy-MM-dd');
    },
    subYears: (date?: string, years?: number | string) => {
      const amount = Number(years);
      if (!date || !amount) return date;
      return format(subYears(parseDate(date), amount), 'yyyy-MM-dd');
    },
    setDay: (date?: string, day?: number) => {
      if (!date || day == null) return date;
      const actualDay = Number(format(date, 'd'));
      return format(addDays(date, day - actualDay), 'yyyy-MM-dd');
    },
    debug: (value: unknown) => {
      logger.log(value);
    },
    concat: (...args: unknown[]) => args.join(''),
  } as Record<string, Handlebars.HelperDelegate>;

  for (const [name, fn] of Object.entries(helpers)) {
    Handlebars.registerHelper(name, (...args: unknown[]) => {
      //The last argument is the Handlebars options object
      return fn(...args.slice(0, -1));
    });
  }
}
