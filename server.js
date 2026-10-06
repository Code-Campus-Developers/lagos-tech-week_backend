import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Lagos Tech Week: http://${host}:${port}`));
function shutdown() { server.close(() => { app.locals.db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
