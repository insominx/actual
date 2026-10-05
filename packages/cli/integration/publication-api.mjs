import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as api from '@actual-app/api';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());
if (!input.dataDir?.includes('actual-agent-cli-')) {
  throw new Error('Publication proof requires a disposable fixture');
}
async function provePublication() {
  await mkdir(input.dataDir, { recursive: true });
  await api.init({ dataDir: input.dataDir });
  try {
    const source = await api.createBudget({
      name: 'Guarded API publication',
      currency: 'CAD',
    });
    const account = await api.createAccount(
      { name: 'Publication cash' },
      45678,
    );
    await api.shutdown();
    await api.init({
      dataDir: input.dataDir,
      serverURL: input.serverUrl,
      password: input.password,
    });
    await api.loadBudget(source.id);
    const identity = await api.inspectBudget();
    const files = await Promise.all(
      ['db.sqlite', 'metadata.json'].map(name =>
        readFile(join(input.dataDir, source.id, name)),
      ),
    );
    const remote = await api.getBudgets();
    const directories = await readdir(input.dataDir);
    const request = {
      id: source.id,
      encrypted: Boolean(input.encryptionPassword),
    };
    const proposal = await api.previewBudgetPublication(request);
    assert.equal(proposal.before.sourceHash.length, 64);
    assert.equal(proposal.budget.id, source.id);
    assert.equal(proposal.references.serverUrl, input.serverUrl);
    assert.deepEqual(await api.inspectBudget(), identity);
    assert.deepEqual(await api.getBudgets(), remote);
    assert.deepEqual(await readdir(input.dataDir), directories);
    assert.deepEqual(
      await Promise.all(
        ['db.sqlite', 'metadata.json'].map(name =>
          readFile(join(input.dataDir, source.id, name)),
        ),
      ),
      files,
    );
    assert.equal(JSON.stringify(proposal).includes(input.password), false);
    if (input.encryptionPassword) {
      assert.equal(
        JSON.stringify(proposal).includes(input.encryptionPassword),
        false,
      );
    }
    await api.createAccount({ name: 'Source changed after preview' }, 100);
    assert.equal(
      (
        await api.applyBudgetPublication(proposal, {
          encryptionPassword: input.encryptionPassword,
        })
      ).code,
      'STALE_PREVIEW',
    );
    assert.equal((await api.inspectBudget()).cloudFileId, null);
    const fresh = await api.previewBudgetPublication(request);
    assert.equal(
      (
        await api.applyBudgetPublication(
          {
            ...fresh,
            references: {
              ...fresh.references,
              serverUrl: input.serverUrl + '/wrong',
            },
          },
          { encryptionPassword: input.encryptionPassword },
        )
      ).status,
      'rejected',
    );
    if (input.encryptionPassword) {
      assert.equal(
        (await api.applyBudgetPublication(fresh)).status,
        'rejected',
      );
    }
    if (input.uploadFault === 'source-race') {
      await fetch(input.serverUrl + '/__arm');
      const applying = api.applyBudgetPublication(fresh, {
        encryptionPassword: input.encryptionPassword,
      });
      const rejection = assert.rejects(
        applying,
        error => error.code === 'publication-uncertain',
      );
      await fetch(input.serverUrl + '/__blocked', {
        signal: AbortSignal.timeout(5000),
      });
      const pending = await api.inspectBudget();
      assert.ok(
        pending.cloudFileId,
        'The source edit must occur after identity preparation',
      );
      await api.createAccount({ name: 'Changed before export' }, 200);
      await fetch(input.serverUrl + '/__release');
      await rejection;
      await assert.rejects(
        api.recoverBudgetPublication(fresh, {
          encryptionPassword: input.encryptionPassword,
        }),
        error => error.code === 'publication-uncertain',
      );
      assert.equal(
        (await api.getBudgets()).some(
          budget =>
            budget.state === 'remote' &&
            budget.cloudFileId === pending.cloudFileId,
        ),
        false,
      );
      console.log(
        JSON.stringify({
          verified: true,
          encrypted: Boolean(input.encryptionPassword),
        }),
      );
      return;
    }
    if (input.uploadFault) {
      await assert.rejects(
        api.applyBudgetPublication(fresh, {
          encryptionPassword: input.encryptionPassword,
        }),
        error => error.code === 'publication-uncertain',
      );
      const pending = await api.inspectBudget();
      assert.ok(pending.cloudFileId);
      if (input.uploadFault === 'before') {
        for (let attempt = 0; attempt < 2; attempt++) {
          await assert.rejects(
            api.recoverBudgetPublication(fresh, {
              encryptionPassword: input.encryptionPassword,
            }),
            error => error.code === 'publication-uncertain',
          );
        }
        assert.equal(
          (await api.getBudgets()).some(
            budget =>
              budget.state === 'remote' &&
              budget.cloudFileId === pending.cloudFileId,
          ),
          false,
        );
        assert.equal(
          (await api.inspectBudget()).cloudFileId,
          pending.cloudFileId,
        );
        console.log(
          JSON.stringify({
            verified: true,
            encrypted: Boolean(input.encryptionPassword),
          }),
        );
        return;
      }
    }
    const published = await (input.uploadFault
      ? api.recoverBudgetPublication(fresh, {
          encryptionPassword: input.encryptionPassword,
        })
      : api.applyBudgetPublication(fresh, {
          encryptionPassword: input.encryptionPassword,
        }));
    assert.equal(published.status, 'committed-local');
    assert.equal(
      published.publication.encrypted,
      Boolean(input.encryptionPassword),
    );
    assert.ok(published.publication.syncId);
    assert.ok(published.publication.cloudFileId);
    const result = await api.inspectBudget();
    assert.equal(result.syncId, published.publication.syncId);
    assert.equal(result.currency, 'CAD');
    assert.equal(await api.getAccountBalance(account), 45678);
    const recovered = await api.recoverBudgetPublication(fresh, {
      encryptionPassword: input.encryptionPassword,
    });
    assert.equal(recovered.status, 'committed-local');
    assert.deepEqual(recovered.publication, published.publication);
    const acknowledgedMetadata = JSON.parse(
      await readFile(join(input.dataDir, source.id, 'metadata.json'), 'utf8'),
    );
    assert.match(
      acknowledgedMetadata.lastUploaded ?? '',
      /^\d{4}-\d{2}-\d{2}$/,
    );
    assert.equal(
      (await api.getBudgets()).filter(
        budget =>
          budget.state === 'remote' &&
          budget.cloudFileId === result.cloudFileId,
      ).length,
      1,
    );
    await api.shutdown();
    const reader = join(input.dataDir, 'independent-reader');
    await mkdir(reader);
    await api.init({
      dataDir: reader,
      serverURL: input.serverUrl,
      password: input.password,
    });
    await api.downloadBudget(result.syncId, {
      password: input.encryptionPassword,
    });
    assert.equal(await api.getAccountBalance(account), 45678);
    assert.equal(
      (await api.getAccounts()).some(
        row => row.name === 'Source changed after preview',
      ),
      true,
    );
    console.log(
      JSON.stringify({
        verified: true,
        encrypted: Boolean(input.encryptionPassword),
        publication: published.publication,
      }),
    );
  } finally {
    await api.shutdown();
  }
}
await provePublication();
