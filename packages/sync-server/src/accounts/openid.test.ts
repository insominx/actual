import { getAccountDb } from '#account-db';

import { loginWithOpenIdFinalize } from './openid';

const tokenSet = { access_token: 'access', expires_at: undefined };
const userInfo = { preferred_username: 'first-openid-admin', name: 'Admin' };

vi.mock('openid-client', () => {
  class Client {
    redirect_uris = ['http://localhost/openid/callback'];
    callback = async () => tokenSet;
    userinfo = async () => userInfo;
  }
  class Issuer {
    Client = Client;
    static discover = async () => new Issuer();
  }
  return {
    Issuer,
    custom: { setHttpOptionsDefaults: vi.fn() },
    generators: {
      state: () => 'state',
      codeVerifier: () => 'verifier',
      codeChallenge: () => 'challenge',
    },
  };
});

const PASSWORD_USER_ID = 'openid-test-password-user';
const FILE_ID = 'openid-test-file';

type UserRow = {
  id: string;
  user_name: string;
  display_name: string | null;
  enabled: number;
  owner: number;
  role: string | null;
};

let savedUsers: UserRow[];

describe('loginWithOpenIdFinalize first login', () => {
  beforeEach(() => {
    const db = getAccountDb();
    // A first login needs a server with no named users yet. Other test files
    // leave files and access rows that reference these users, so the delete
    // would fail on a foreign key; the users are restored in afterEach.
    db.exec('PRAGMA foreign_keys = OFF');
    savedUsers = db.all('SELECT * FROM users') as UserRow[];
    db.mutate('DELETE FROM users');
    db.mutate('DELETE FROM auth');
    db.mutate('DELETE FROM pending_openid_requests');
    db.mutate(
      "INSERT INTO auth (method, display_name, extra_data, active) VALUES ('openid', 'OpenID', ?, 1)",
      [
        JSON.stringify({
          issuer: 'https://issuer.example.com',
          client_id: 'id',
          client_secret: 'secret',
          server_hostname: 'http://localhost',
        }),
      ],
    );
    db.mutate(
      'INSERT INTO pending_openid_requests (state, code_verifier, return_url, expiry_time) VALUES (?, ?, ?, ?)',
      ['state-1', 'verifier', 'http://localhost', Date.now() + 60000],
    );
    db.mutate(
      "INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES (?, '', '', 1, 1, 'ADMIN')",
      [PASSWORD_USER_ID],
    );
    db.mutate('INSERT INTO files (id, owner) VALUES (?, ?)', [
      FILE_ID,
      PASSWORD_USER_ID,
    ]);
  });

  afterEach(() => {
    const db = getAccountDb();
    db.mutate('DELETE FROM files WHERE id = ?', [FILE_ID]);
    db.mutate('DELETE FROM sessions WHERE auth_method = ?', ['openid']);
    db.mutate('DELETE FROM users');
    for (const user of savedUsers) {
      db.mutate(
        'INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES (?, ?, ?, ?, ?, ?)',
        [
          user.id,
          user.user_name,
          user.display_name,
          user.enabled,
          user.owner,
          user.role,
        ],
      );
    }
    db.mutate('DELETE FROM auth');
    db.mutate('DELETE FROM pending_openid_requests');
    db.exec('PRAGMA foreign_keys = ON');
  });

  it('hands files owned by the password user to the first OpenID admin', async () => {
    const result = await loginWithOpenIdFinalize({
      code: 'code',
      state: 'state-1',
    });

    expect(result.error).toBeUndefined();

    const admin = getAccountDb().first(
      'SELECT id FROM users WHERE user_name = ?',
      ['first-openid-admin'],
    );
    const file = getAccountDb().first('SELECT owner FROM files WHERE id = ?', [
      FILE_ID,
    ]);
    expect(file.owner).toBe(admin.id);
  });

  it('rejects a replayed callback because the state is single-use', async () => {
    const first = await loginWithOpenIdFinalize({
      code: 'code',
      state: 'state-1',
    });
    expect(first.error).toBeUndefined();

    const replay = await loginWithOpenIdFinalize({
      code: 'code',
      state: 'state-1',
    });
    expect(replay).toEqual({ error: 'invalid-or-expired-state' });
  });

  it('does not consume the state when the request is not valid', async () => {
    expect(await loginWithOpenIdFinalize({ code: 'code' })).toEqual({
      error: 'missing-state',
    });

    const pending = getAccountDb().first(
      'SELECT state FROM pending_openid_requests WHERE state = ?',
      ['state-1'],
    );
    expect(pending).toBeTruthy();
  });
});
