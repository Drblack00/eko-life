// ============================================================
// app.js — Èkó Life application composition (testable factory)
// Creates: express app → /api router, static web/dist + SPA fallback,
// WS hub, game-day ticker. No side effects on import; tests use
// createApp() and start on an ephemeral port.
// ============================================================
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { initDb, dbMode } from './db.js';
import { createApiRouter } from './routes/api.js';
import { createHub } from './ws/hub.js';
import { DAY_MS } from './game/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await initDb();

  const app = express();
  app.use(express.json({ limit: '32kb' }));

  // ---- security headers ----
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // M4: lock down powerful browser features; HSTS is a no-op on plain HTTP
    // (local dev/tests) and enforced on Render's TLS in production.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  // ---- shared game-day state (full sim lands in M2) ----
  const state = { day: 1, dayStart: Date.now() };
  const getDay = () => ({
    day: state.day,
    endsIn: Math.max(0, DAY_MS - (Date.now() - state.dayStart)),
  });

  const hub = createHub({ getDay });

  // M5: seed rooms, ensure an election cycle, restore the governor —
  // before any WS client connects.
  await hub.bootGame();

  // ---- API ----
  app.use('/api', createApiRouter({ hub, getDay }));

  // ---- static client (web/dist) + SPA fallback ----
  const dist = path.join(__dirname, '../../web/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    console.log('[boot] serving static client from web/dist');
  } else {
    console.log('[boot] web/dist not built yet — serving API only');
  }
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
    if (existsSync(dist)) return res.sendFile(path.join(dist, 'index.html'));
    return res.status(404).json({ error: 'Client not built yet.' });
  });

  // ---- error handler (M4): never leak stack traces to clients ----
  // Must sit after every route so it catches JSON-parse errors and any
  // unhandled async route failure. Logs server-side, generic JSON to client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[500]', req.method, req.path, '-', err && err.message);
    if (res.headersSent) return next(err);
    const status = err && err.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: 'Something went wrong.' });
  });

  const server = createServer(app);
  hub.attach(server);

  // ---- game-day ticker (M2): rent settlement + day broadcast ----
  const tick = setInterval(async () => {
    if (Date.now() - state.dayStart >= DAY_MS) {
      state.day += 1;
      state.dayStart = Date.now();
      try { await hub.dayRollover(); } catch (e) { console.error('[day]', e.message); }
      console.log(`[day] Day ${state.day} — ${hub.onlineCount()} online`);
    }
  }, 1000);
  if (tick.unref) tick.unref();

  // ---- needs-decay ticker (M2): every 60s, persist + push `you` ----
  const decay = setInterval(() => {
    hub.decayTickAll().catch(e => console.error('[decay]', e.message));
  }, 60000);
  if (decay.unref) decay.unref();

  // ---- street-find spawn ticker (M3): every 15s, prune + spawn near players ----
  const spawns = setInterval(() => {
    try { hub.spawnTick(); } catch (e) { console.error('[spawn]', e.message); }
  }, 15000);
  if (spawns.unref) spawns.unref();

  async function start(port) {
    await new Promise((resolve) => server.listen(port, resolve));
    const actual = server.address().port;
    console.log(`[boot] Èkó Life server live on port ${actual} — Day ${state.day} — db: ${dbMode()}`);
    return actual;
  }

  async function close() {
    clearInterval(tick);
    clearInterval(decay);
    clearInterval(spawns);
    await new Promise((resolve) => server.close(resolve));
  }

  return { app, server, hub, getDay, start, close };
}
