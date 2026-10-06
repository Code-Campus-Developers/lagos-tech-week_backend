import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const success = { message: 'Your interest is registered. Look out for Lagos Tech Week announcements.' };

export function createApp({
  databasePath = process.env.DATABASE_PATH || resolve(here, 'data/subscribers.sqlite'),
  limit = 10,
  brevoApiKey = process.env.BREVO_API_KEY,
  brevoListId = process.env.BREVO_LIST_ID,
  fetchImpl = fetch,
} = {}) {
  if (Boolean(brevoApiKey) !== Boolean(brevoListId)) throw new Error('BREVO_API_KEY and BREVO_LIST_ID must be configured together.');
  const brevoListIdNumber = brevoListId ? Number(brevoListId) : null;
  if (brevoListId && (!Number.isSafeInteger(brevoListIdNumber) || brevoListIdNumber < 1)) throw new Error('BREVO_LIST_ID must be a positive integer.');
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      consent_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );`);
  const insert = db.prepare('INSERT INTO subscribers (email, consent_version) VALUES (?, ?) ON CONFLICT(email) DO NOTHING');
  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use(helmet());
  const origins = (process.env.FRONTEND_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use(express.json({ limit: '4kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/subscribe', rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } }), async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Please send your signup as JSON.' });
    const { email, consent, website } = req.body || {};
    if (typeof website === 'string' && website.trim()) return res.status(200).json(success);
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (consent !== true) return res.status(400).json({ error: 'Please agree to receive event announcements before joining.' });
    if (brevoApiKey && brevoListIdNumber) {
      try {
        const response = await fetchImpl('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: { accept: 'application/json', 'api-key': brevoApiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ email: normalized, listIds: [brevoListIdNumber], updateEnabled: true }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          console.error('Brevo contact sync failed with status:', response.status);
          return res.status(502).json({ error: 'We couldn’t add your email right now. Please try again.' });
        }
      } catch (error) {
        console.error('Brevo contact sync failed:', error.name || 'RequestError');
        return res.status(502).json({ error: 'We couldn’t add your email right now. Please try again.' });
      }
    }
    insert.run(normalized, 'event-updates-v1');
    res.set('Cache-Control', 'no-store').status(200).json(success);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'This API route does not exist.' }));
  // Optional combined hosting; the API runs independently by default.
  if (process.env.FRONTEND_DIST) app.use(express.static(resolve(process.env.FRONTEND_DIST)));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request. Please try again.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
    console.error('Request failed:', err.code || err.name);
    res.status(500).json({ error: 'We couldn’t save your email. Please try again in a moment.' });
  });
  return app;
}
