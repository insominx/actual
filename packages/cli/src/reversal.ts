// Reversal planning for guarded changes. A reversal is a new compensating
// guarded operation with its own operation ID and receipt; it is built from
// the original receipt's before-values and only runs when the records still
// hold the original after-values. Anything else is refused with the reason
// and backup recovery guidance. There is no universal undo.
import type * as api from '@actual-app/api';

import type { ChangeReceipt } from './change-journal';
import { stableJson } from './utils';

export const REVERSIBLE_OPERATIONS = [
  'transactions.categorize',
  'budgets.move',
  'cash-planning.save',
] as const;

export type ReversibleOperation = (typeof REVERSIBLE_OPERATIONS)[number];

export const BACKUP_RECOVERY = [
  'actual backups list',
  'actual --offline backups restore <artifact>.actualbackup --name "Recovery copy" --operation-id <unique-id>',
  'actual --offline budgets compare <current-budget-id> <restored-budget-id>',
  'Copy the needed values into the live budget with explicit, previewed changes; a restore never replaces the live budget.',
];

export type ReversalPlan =
  | {
      supported: true;
      operation: ReversibleOperation;
      request: Record<string, unknown>;
      preconditions: string[];
    }
  | { supported: false; reason: string; recovery: string[] };

const UNSUPPORTED: Record<string, string> = {
  'transactions.merge':
    'A merge deletes one transaction and moves its fields into the other; the engine has no un-merge.',
  'transactions.import':
    'An import adds and may update transactions; reversing it could remove rows edited or matched since.',
  'imports.file':
    'A file import adds and may update transactions; reversing it could remove rows edited or matched since.',
  'transactions.add':
    'Added rows may have been edited, matched or reconciled since; delete them explicitly after checking.',
  'transactions.delete':
    'Deleted records cannot be recreated with their original identity.',
  'categories.delete':
    'Deleted records cannot be recreated with their original identity.',
  'category-groups.delete':
    'Deleted records cannot be recreated with their original identity.',
  'payees.delete':
    'Deleted records cannot be recreated with their original identity.',
  'payees.merge':
    'A payee merge deletes the merged payees and rewrites references; the engine has no un-merge.',
  'accounts.delete':
    'Deleted records cannot be recreated with their original identity.',
  'reconcile.finish':
    'Unlock reconciled rows explicitly with transactions clear --unlock after checking them.',
};

function unsupported(reason: string): ReversalPlan {
  return { supported: false, reason, recovery: BACKUP_RECOVERY };
}

export function planReversal(receipt: ChangeReceipt): ReversalPlan {
  if (receipt.state === 'uncertain') {
    return unsupported(
      'The original outcome is uncertain. Diagnose it first (changes inspect); an uncertain change is never reversed or replayed automatically.',
    );
  }
  if (receipt.state === 'prepared') {
    return unsupported('The change was prepared but never applied.');
  }
  if (receipt.state === 'failed-before-commit') {
    return unsupported('The change failed before commit; nothing changed.');
  }
  const proposal = receipt.proposal;
  switch (proposal.operation) {
    case 'transactions.categorize': {
      const changed = new Set(proposal.after.changedIds);
      if (!changed.size) return unsupported('The change modified nothing.');
      const before = proposal.before.transactions.filter(t =>
        changed.has(t.id),
      );
      const categories = [...new Set(before.map(t => t.category))];
      if (categories.length !== 1) {
        return unsupported(
          `The transactions had ${categories.length} different categories before; reverse each group with transactions categorize using the receipt's before values.`,
        );
      }
      return {
        supported: true,
        operation: 'transactions.categorize',
        request: { ids: [...changed].sort(), category: categories[0] },
        preconditions: [
          'every changed transaction still has the category this change set',
          'amounts, accounts, dates, splits and transfer links are unchanged',
          'no changed transaction is reconciled now',
        ],
      };
    }
    case 'budgets.move': {
      const r = proposal.request;
      return {
        supported: true,
        operation: 'budgets.move',
        request: { month: r.month, from: r.to, to: r.from, amount: r.amount },
        preconditions: [
          'both categories still hold the budgeted amounts this move left',
          'the destination still has enough to give back (no overspend)',
        ],
      };
    }
    case 'cash-planning.save': {
      const value = proposal.before.preference?.value ?? null;
      let config: unknown = null;
      if (value !== null) {
        try {
          config = JSON.parse(value);
        } catch {
          return unsupported('The earlier cash plan is not readable JSON.');
        }
      }
      return {
        supported: true,
        operation: 'cash-planning.save',
        request: { config },
        preconditions: [
          'the saved cash plan still equals the plan this change saved',
          'the earlier plan restores exactly',
        ],
      };
    }
    default:
      return unsupported(
        UNSUPPORTED[proposal.operation] ??
          `No inverse is defined for ${proposal.operation}. Use the receipt's before values to make a new explicit change.`,
      );
  }
}

/**
 * Compares a freshly prepared inverse proposal with the original receipt.
 * Returns the reasons the inverse would overwrite later edits.
 */
export function reversalConflicts(
  original: ChangeReceipt,
  inverse: api.ChangeProposal,
): string[] {
  const proposal = original.proposal;
  const conflicts: string[] = [];
  if (
    proposal.operation === 'transactions.categorize' &&
    inverse.operation === 'transactions.categorize'
  ) {
    const was = new Map(proposal.before.transactions.map(t => [t.id, t]));
    for (const now of inverse.before.transactions) {
      const then = was.get(now.id);
      if (!then) {
        conflicts.push(`${now.id}: not part of the original change`);
        continue;
      }
      if (now.category !== proposal.request.category) {
        conflicts.push(`${now.id}: category changed after the original change`);
      }
      if (
        now.amount !== then.amount ||
        now.account !== then.account ||
        now.date !== then.date ||
        now.parentId !== then.parentId ||
        now.transferId !== then.transferId
      ) {
        conflicts.push(
          `${now.id}: amount, account, date, split or transfer link changed`,
        );
      }
      if (now.reconciled) conflicts.push(`${now.id}: reconciled`);
    }
    return conflicts;
  }
  if (
    proposal.operation === 'budgets.move' &&
    inverse.operation === 'budgets.move'
  ) {
    if (inverse.before.from.budgeted !== proposal.after.to.budgeted) {
      conflicts.push(
        `${proposal.request.to}: budgeted amount changed after the move`,
      );
    }
    if (inverse.before.to.budgeted !== proposal.after.from.budgeted) {
      conflicts.push(
        `${proposal.request.from}: budgeted amount changed after the move`,
      );
    }
    return conflicts;
  }
  if (
    proposal.operation === 'cash-planning.save' &&
    inverse.operation === 'cash-planning.save'
  ) {
    if (
      (inverse.before.preference?.value ?? null) !==
      proposal.after.preference.value
    ) {
      conflicts.push('the cash plan changed after the original save');
    }
    if (
      inverse.after.preference.value !==
      (proposal.before.preference?.value ?? null)
    ) {
      conflicts.push(
        'the earlier cash plan no longer restores exactly (it validates differently today)',
      );
    }
    return conflicts;
  }
  return [
    `the prepared inverse ${inverse.operation} does not match ${proposal.operation}`,
  ];
}

export function sameRequest(a: unknown, b: unknown) {
  return stableJson(a) === stableJson(b);
}

/** Read-only diagnosis of a receipt's state and the safe next steps. */
export function diagnoseReceipt(receipt: ChangeReceipt) {
  const plan = planReversal(receipt);
  const id = receipt.operationId;
  const byState: Record<
    ChangeReceipt['state'],
    { meaning: string; next: string[] }
  > = {
    prepared: {
      meaning: 'Prepared and never applied; the budget is unchanged.',
      next: [
        `actual changes apply ${id} --token ${receipt.token}`,
        'Or abandon it; a prepared change expires without writing.',
      ],
    },
    'failed-before-commit': {
      meaning: 'Failed before commit; the budget is unchanged.',
      next: ['Prepare a new change with a new operation ID if still needed.'],
    },
    uncertain: {
      meaning:
        'The process stopped after the engine may have written. The outcome is unknown and is never replayed.',
      next: [
        'actual sync',
        `actual changes status ${id}`,
        "Check the affected records against the proposal's before and after values (for example with actual query).",
        ...BACKUP_RECOVERY,
      ],
    },
    'committed-local': {
      meaning:
        'Committed to the local budget; synchronization was not acknowledged.',
      next: [
        'actual sync',
        ...(plan.supported
          ? [`actual changes reverse ${id} --operation-id <new-id> [--preview]`]
          : []),
      ],
    },
    synced: {
      meaning: 'Committed and acknowledged by the server.',
      next: plan.supported
        ? [`actual changes reverse ${id} --operation-id <new-id> [--preview]`]
        : BACKUP_RECOVERY,
    },
  };
  return {
    operationId: id,
    operation: receipt.proposal.operation,
    state: receipt.state,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
    diagnosis: byState[receipt.state].meaning,
    nextSteps: byState[receipt.state].next,
    reversal: plan,
  };
}
