import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';

async function start(options = {}) {
  const app = createApp({ databasePath: ':memory:', ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    app,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { await new Promise(resolve => server.close(resolve)); app.locals.db.close(); },
  };
}

function signup(url, payload) {
  return fetch(`${url}/api/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

test('signups persist after restart and duplicate addresses create only one record', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lagos-signup-'));
  const databasePath = join(directory, 'test.sqlite');
  let instance;
  try {
    instance = await start({ databasePath });
    const first = await signup(instance.url, { email: ' Person@Example.com ', consent: true });
    assert.equal(first.status, 200);
    await first.json();
    await instance.close();
    instance = await start({ databasePath });
    const duplicate = await signup(instance.url, { email: 'person@example.com', consent: true });
    assert.equal(duplicate.status, 200);
    await duplicate.json();
    const rows = instance.app.locals.db.prepare('SELECT * FROM subscribers').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'person@example.com');
    assert.equal(rows[0].consent_version, 'event-updates-v1');
    assert.ok(rows[0].created_at);
  } finally { if (instance) await instance.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid emails, missing consent, malformed requests and bots do not add subscribers', async () => {
  const instance = await start();
  try {
    for (const payload of [{ email: 'not-an-email', consent: true }, { email: 'a@example.com' }, { email: 42, consent: true }, { email: 'a@example.com', consent: 'true' }]) {
      const response = await signup(instance.url, payload);
      assert.equal(response.status, 400);
      assert.ok((await response.json()).error);
    }
    const malformed = await fetch(`${instance.url}/api/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(malformed.status, 400);
    const bot = await signup(instance.url, { email: 'bot@example.com', consent: true, website: 'https://spam.example' });
    assert.equal(bot.status, 200);
    assert.equal(instance.app.locals.db.prepare('SELECT COUNT(*) AS count FROM subscribers').get().count, 0);
    assert.equal((await fetch(`${instance.url}/api/subscribers`)).status, 404);
  } finally { await instance.close(); }
});

test('signup attempts are rate limited', async () => {
  const instance = await start({ limit: 1 });
  try {
    const first = await signup(instance.url, { email: 'one@example.com', consent: true });
    assert.equal(first.status, 200);
    const second = await signup(instance.url, { email: 'two@example.com', consent: true });
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /Too many/);
  } finally { await instance.close(); }
});
