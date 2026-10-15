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
// V2 milestones: real-time clock + shifts (M7), city events (M8), daily
// hunt rotation (M9). ensureSchema for every v2 module at boot.
import { ensureSchema as m7Schema, onTickMinute as m7Tick, lagosNow as m7LagosNow } from './game/v2/m7.js';
import { ensureSchema as m8Schema, onTickMinute as m8Tick, triggerMoodlet as m8TriggerMoodlet } from './game/v2/m8.js';
import { ensureSchema as m9Schema, onTickMinute as m9Tick, bootM9 } from './game/v2/m9.js';
import { ensureSchema as m10Schema } from './game/v2/m10.js';
import { ensureSchema as m11Schema } from './game/v2/m11.js';
import { ensureSchema as m12Schema } from './game/v2/m12.js';
import { ensureSchema as m13Schema } from './game/v2/m13.js';
// Fintech foundation (M5/M6a): chart of accounts + fee policy v1 seeding.
import { ensureChartOfAccounts, ensureFeePolicyV1 } from './fintech/seed.js';
// Phase 3 (News tab): headline-aggregator refresh job (title + source +
// link + short snippet only; failures logged and skipped per-feed).
import { refreshNewsFeeds } from './news.js';
import { NEWS_CACHE_MS } from './db.js';
// Fintech cash-wallet routes (Milestones 5-9): every route sits behind
// requireCashOps, so all return 403 while CASH_OPS_ENABLED is off.
import { createCashWalletRouter } from './routes/cashWallet.js';
import { createCashFlowsRouter } from './routes/cashFlows.js';
import { createCashAdminRouter } from './routes/cashAdmin.js';
import { createCloudSaveRouter } from './routes/cloudSave.js';
// Express 4 async safety: patch Router.prototype once at boot so every
// async route handler auto-forwards rejections to error middleware.
import { patchExpressAsync } from './lib/asyncHandler.js';

patchExpressAsync();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await initDb();

  // Migrations (2026-10-15): idempotent schema migrations run after the
  // legacy inline schema. New installs apply them; existing installs skip
  // via the meta-table record. See server/migrations/README.md.
  const { runMigrations } = await import('../migrations/runner.js');
  await runMigrations();

  // Fintech foundation (M5/M6a): idempotent seeding of the chart of
  // accounts and the v1 fee policy. Uses INSERT OR IGNORE / ON CONFLICT
  // DO NOTHING, so it is safe to run on every boot.
  await ensureChartOfAccounts();
  await ensureFeePolicyV1();

  const app = express();
  // verify() captures the raw request bytes on req.rawBody. The
  // provider webhook route (POST /api/cash-wallet/deposit/webhook/:provider)
  // verifies provider signatures over the EXACT bytes that arrived —
  // re-serializing req.body would produce different bytes and break
  // HMAC verification. Harmless for every other route (parsed body is
  // unchanged).
  app.use(express.json({
    limit: '32kb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

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

  // Phase 3: news headline cache refresh — every 30 min + once at boot
  // (fire-and-forget; a dead feed never blocks startup or requests).
  // triggerNewsRefresh is debounced: overlapping refreshes are skipped.
  let newsRefreshing = false;
  const triggerNewsRefresh = () => {
    if (newsRefreshing) return;
    newsRefreshing = true;
    refreshNewsFeeds()
      .catch((e) => console.error('[news] refresh:', e.message))
      .finally(() => { newsRefreshing = false; });
  };
  hub.triggerNewsRefresh = triggerNewsRefresh;
  const newsTimer = setInterval(triggerNewsRefresh, NEWS_CACHE_MS);
  if (newsTimer.unref) newsTimer.unref();
  triggerNewsRefresh();

  // M5: seed rooms, ensure an election cycle, restore the governor —
  // before any WS client connects.
  await hub.bootGame();

  // V2: module schemas (own tables), then M9 boot (hunt round safety net).
  await m7Schema();
  await m8Schema();
  await m9Schema();
  await m10Schema();
  await m11Schema();
  await m12Schema();
  await m13Schema();
  await bootM9({ broadcast: (m) => hub.broadcast(m) });

  // ---- API ----
  app.use('/api', createApiRouter({ hub, getDay }));
  // ---- Cloud saves: per-user ancillary state sync ----
  app.use('/api', createCloudSaveRouter());
  // ---- Cash wallet (fintech): inert 403s while CASH_OPS_ENABLED is off ----
  app.use('/api/cash-wallet', createCashWalletRouter());
  app.use('/api/cash-wallet', createCashFlowsRouter());
  app.use('/api/admin/cash', createCashAdminRouter());

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

  // ---- V2: real-time Lagos clock broadcast (M7) — every 30s ----
  const clock = setInterval(() => {
    try { hub.broadcast({ t: 'clock', ...m7LagosNow() }); } catch (e) { console.error('[clock]', e.message); }
  }, 30000);
  if (clock.unref) clock.unref();

  // ---- V2: per-minute ticks (M7 shifts, M8 city events, M9 hunt rotation) ----
  const v2tick = setInterval(async () => {
    try { await m8Tick({ broadcast: (m) => hub.broadcast(m), pushNews: hub.pushNews }); }
    catch (e) { console.error('[m8]', e.message); }
    try { await m9Tick({ broadcast: (m) => hub.broadcast(m), pushNews: hub.pushNews }); }
    catch (e) { console.error('[m9]', e.message); }
    try {
      const done = await m7Tick({
        broadcast: (m) => hub.broadcast(m),
        sendTo: (uid, msg) => hub.sendTo(uid, msg),
        getDay, now: Date.now(),
        refreshYou: (uid) => hub.pushYou(uid),
      });
      // M8: payday groove moodlet for completed shifts.
      for (const d of done || []) {
        try { await m8TriggerMoodlet(d.userId, 'payday_groove'); } catch (e) { console.error('[m8] payday:', e.message); }
      }
    } catch (e) { console.error('[m7]', e.message); }
  }, 60000);
  if (v2tick.unref) v2tick.unref();

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
    clearInterval(clock);
    clearInterval(v2tick);
    clearInterval(newsTimer);
    await new Promise((resolve) => server.close(resolve));
  }

  return { app, server, hub, getDay, start, close };
}
