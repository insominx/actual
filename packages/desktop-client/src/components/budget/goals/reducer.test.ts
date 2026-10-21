import type { Template } from '@actual-app/core/types/models/templates';
import { describe, expect, it } from 'vitest';

import {
  alignSchedulePriority,
  DEFAULT_PRIORITY,
  getInitialState,
  templateReducer,
} from './reducer';
import { validateSchedulePriorities } from './validateAutomation';

// `#template schedule Rent` (no `-N`) parses with priority 0
const parsedSchedule = {
  directive: 'template',
  type: 'schedule',
  name: 'Rent',
  priority: 0,
} satisfies Template;

describe('alignSchedulePriority', () => {
  it('adopts the priority of an existing schedule template for a new by template', () => {
    const state = templateReducer(
      getInitialState({
        directive: 'template',
        type: 'periodic',
        amount: 100,
        period: { period: 'month', amount: 1 },
        starting: '2026-01-01',
        priority: DEFAULT_PRIORITY,
      }),
      { type: 'set-type', payload: 'by' },
    );
    expect(state.template).toMatchObject({ priority: DEFAULT_PRIORITY });

    const aligned = alignSchedulePriority(state.template, [parsedSchedule]);

    expect(aligned).toMatchObject({ type: 'by', priority: 0 });
    expect(validateSchedulePriorities([parsedSchedule, aligned])).toBeNull();
  });

  it('adopts the priority of an existing by template for a new schedule template', () => {
    const existingBy = {
      directive: 'template',
      type: 'by',
      amount: 1200,
      month: '2027-01',
      priority: 3,
    } satisfies Template;
    const newSchedule = {
      directive: 'template',
      type: 'schedule',
      name: '',
      priority: DEFAULT_PRIORITY,
    } satisfies Template;

    expect(alignSchedulePriority(newSchedule, [existingBy])).toEqual({
      ...newSchedule,
      priority: 3,
    });
  });

  it('keeps the default priority when there is no schedule or by template', () => {
    const newSchedule = {
      directive: 'template',
      type: 'schedule',
      name: '',
      priority: DEFAULT_PRIORITY,
    } satisfies Template;
    const periodic = {
      directive: 'template',
      type: 'periodic',
      amount: 100,
      period: { period: 'month', amount: 1 },
      starting: '2026-01-01',
      priority: 0,
    } satisfies Template;

    expect(alignSchedulePriority(newSchedule, [periodic])).toBe(newSchedule);
  });

  it('leaves non schedule/by templates untouched', () => {
    const periodic = {
      directive: 'template',
      type: 'periodic',
      amount: 100,
      period: { period: 'month', amount: 1 },
      starting: '2026-01-01',
      priority: DEFAULT_PRIORITY,
    } satisfies Template;

    expect(alignSchedulePriority(periodic, [parsedSchedule])).toBe(periodic);
  });
});

describe('getInitialState', () => {
  it('keeps the limit of a simple template', () => {
    const limit = { amount: 200, hold: false, period: 'monthly' as const };
    const state = getInitialState({
      directive: 'template',
      type: 'simple',
      monthly: 50,
      limit,
      priority: 0,
    });

    expect(state.template).toMatchObject({
      type: 'periodic',
      amount: 50,
      limit,
    });
  });
});
