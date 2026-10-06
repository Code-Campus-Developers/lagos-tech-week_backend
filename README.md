# Lagos Tech Week backend

An independent Express API that saves event-interest signups in SQLite. This repository does not require the frontend source.

## Run

Requires Node.js 22.13 or newer. Node 22 may print an experimental warning for its built-in SQLite module.

```sh
npm ci
npm run dev
```

The default address is http://127.0.0.1:3001. Use `npm start` for production. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm`.

Copy `.env.example` to `.env` to customize settings:

- `PORT`: API port; defaults to 3001.
- `HOST`: defaults to 127.0.0.1; use 0.0.0.0 where required by your host.
- `DATABASE_PATH`: database file location; the default is `data/subscribers.sqlite` in this repository. Use a persistent disk in production.
- `BREVO_API_KEY` and `BREVO_LIST_ID`: configure both to add new consented signups to the Brevo contact list. Keep the API key in `.env` or the hosting provider's secret settings, never in frontend code. Leave both empty for local-only development.
- `FRONTEND_ORIGINS`: comma-separated allowed frontend origins, such as `https://www.example.com`. Required for browsers accessing a separately hosted frontend/API directly. No trailing slash or page path.
- `TRUST_PROXY`: configure only to match your host's actual proxy arrangement.
- `FRONTEND_DIST`: optional absolute path to a built frontend for combined hosting. Leave empty for an independent API.

## API

- `GET /api/health`: returns `{ "status": "ok" }`.
- `POST /api/subscribe`: accepts JSON `{ "email": "you@example.com", "consent": true, "website": "" }`. The website field is a bot honeypot and must be empty.

The API validates email and consent, normalizes and deduplicates email addresses, limits repeated attempts, and stores consent and signup timestamps. When Brevo is configured, each accepted signup is also added to that list; Brevo failures return a retryable error. There is no public subscriber-list endpoint. Database files and environment secrets are excluded from Git.

Signups are saved, but announcement emails are not sent automatically. Connect an email provider separately before sending updates.

## Deploy separately

Run on a Node host with durable disk and HTTPS. Configure the frontend's `VITE_API_BASE_URL` with this API's public origin before building the frontend, and configure `FRONTEND_ORIGINS` with the frontend origin here. Repository URLs and deployed service URLs are different.

SQLite is intended for a single server with persistent disk, not disposable serverless instances or multiple independent replicas. Back up the database as part of normal hosting operations.

## Tests

Run `npm test` to verify persistent storage, duplicate handling, invalid requests, bot filtering, and rate limits. Tests use disposable databases.
