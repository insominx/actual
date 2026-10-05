// @ts-strict-ignore
import type { AmountOPType, APIScheduleEntity } from '#server/api-models';
// Maps public schedule update fields onto a loaded schedule entity. Shared by
// the legacy api/schedule-update handler and guarded schedule updates so both
// interpret public fields identically. Mutates `sched` and reports whether
// anything was assigned.
import { aqlQuery } from '#server/aql';
import { APIError } from '#server/errors';
import { q } from '#shared/query';
import type { ScheduleEntity } from '#types/models';

export async function applyApiScheduleFields(
  sched: ScheduleEntity,
  fields: Partial<APIScheduleEntity>,
) {
  let conditionsUpdated = false;
  // Find all indices to avoid direct assignment
  const payeeIndex = sched._conditions.findIndex(c => c.field === 'payee');
  const accountIndex = sched._conditions.findIndex(c => c.field === 'account');
  const dateIndex = sched._conditions.findIndex(c => c.field === 'date');
  const amountIndex = sched._conditions.findIndex(c => c.field === 'amount');

  for (const key in fields) {
    const typedKey = key as keyof APIScheduleEntity;
    const value = fields[typedKey];

    switch (typedKey) {
      case 'name': {
        const newName = String(value);
        const { data: existing } = await aqlQuery(
          q('schedules').filter({ name: newName }).select('*'),
        );
        if (!existing || existing.length === 0 || existing[0].id === sched.id) {
          sched.name = newName;
          conditionsUpdated = true;
        } else {
          throw APIError(`There is already a schedule named: ${newName}`);
        }
        break;
      }
      case 'next_date':
      case 'completed': {
        throw APIError(
          `Field ${typedKey} is system-managed and not user-editable.`,
        );
      }
      case 'posts_transaction': {
        sched.posts_transaction = Boolean(value);
        conditionsUpdated = true;
        break;
      }
      case 'payee': {
        if (payeeIndex !== -1) {
          sched._conditions[payeeIndex].value = value;
          conditionsUpdated = true;
        } else {
          sched._conditions.push({
            field: 'payee',
            op: 'is',
            value: String(value),
          });
          conditionsUpdated = true;
        }
        break;
      }
      case 'account': {
        if (accountIndex !== -1) {
          sched._conditions[accountIndex].value = value;
          conditionsUpdated = true;
        } else {
          sched._conditions.push({
            field: 'account',
            op: 'is',
            value: String(value),
          });
          conditionsUpdated = true;
        }
        break;
      }
      case 'amountOp': {
        if (amountIndex !== -1) {
          let convertedOp: AmountOPType;
          switch (value) {
            case 'is':
              convertedOp = 'is';
              break;
            case 'isapprox':
              convertedOp = 'isapprox';
              break;
            case 'isbetween':
              convertedOp = 'isbetween';
              break;
            default:
              throw APIError(
                `Invalid amount operator: ${String(value)}. Expected: is, isapprox, or isbetween`,
              );
          }
          sched._conditions[amountIndex].op = convertedOp;
          conditionsUpdated = true;
        } else {
          throw APIError(`Ammount can not be found. There is a bug here`);
        }
        break;
      }
      case 'amount': {
        if (amountIndex !== -1) {
          sched._conditions[amountIndex].value = value;
          conditionsUpdated = true;
        } else {
          throw APIError(`Ammount can not be found. There is a bug here`);
        }
        break;
      }
      case 'date': {
        if (dateIndex !== -1) {
          sched._conditions[dateIndex].value = value;
          conditionsUpdated = true;
        } else {
          throw APIError(
            `Date can not be found. Schedules can not be created without a date there is a bug here`,
          );
        }
        break;
      }
      default: {
        throw APIError(`Unhandled field: ${typedKey}`);
      }
    }
  }

  return conditionsUpdated;
}
