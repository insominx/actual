import assert from 'node:assert/strict';

import {
  assertRawEffect,
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

function verifyPayeeCreated(before, after, name, expectedId) {
  const payees = createdRows(before, after, 'payees');
  const mappings = createdRows(before, after, 'payee_mapping');
  assert.equal(payees.length, 1);
  assert.equal(mappings.length, 1);
  const [payee] = payees;
  if (expectedId) assert.equal(payee.id, expectedId);
  assert.equal(payee.name, name);
  assert.equal(payee.transfer_acct, null);
  assert.equal(payee.tombstone, 0);
  assert.deepEqual(mappings[0], { id: payee.id, targetId: payee.id });
  assertRawEffect(before, after, expected => {
    expected.payees.push(payee);
    expected.payee_mapping.push(mappings[0]);
  });
  return payee.id;
}

const creation = {
  operation: 'payees.create',
  label: 'payee creation',
  data: () => ({ name: '  Packaged exact payee  ', transfer_acct: 'ignored' }),
  otherData: () => ({ name: 'Another payee' }),
  verify(before, after, { proposal, outcome }) {
    const id = verifyPayeeCreated(
      before,
      after,
      proposal.request.name,
      outcome?.payeeCreation?.payeeId,
    );
    if (outcome) {
      assert.deepEqual(outcome.affectedIds, [id]);
      assert.equal(outcome.payeeCreation.mappingId, id);
    }
  },
  direct: () => ({
    args: ['payees', 'create', '--name', 'Direct payee'],
    verify(before, after, result) {
      assert.equal(
        verifyPayeeCreated(before, after, 'Direct payee'),
        result.id,
      );
    },
  }),
  laterEdit: (_f, _ctx, outcome) => [
    'payees',
    'update',
    outcome.payeeCreation.payeeId,
    '--name',
    'Later payee name',
  ],
  independent: (_f, _ctx, outcome) => ({
    args: ['payees', 'list'],
    check(rows) {
      assert.equal(
        rows.filter(row => row.id === outcome.payeeCreation.payeeId).length,
        1,
      );
    },
  }),
};

guardedRegularCases(creation);
guardedInterruptionCases(creation);
