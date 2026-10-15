// ============================================================
// routes/cloudSave.js — per-user cloud saves (TASK 1).
//
// Syncs ancillary per-user state that was previously stuck in
// browser localStorage (blocked-users map, walkthrough completion,
// character-creation flag) so it follows the account across devices.
//
// CONFLICT RESOLUTION (server-timestamp-wins):
//   The client sends client_updated_at = the updated_at it last saw
//   from the server (its last successful save or the load). The PUT
//   handler compares it against the stored updated_at. If the stored
//   row is NEWER than what the client saw AND the payloads actually
//   differ, the server refuses to overwrite and answers 409 with the
//   server payload + server timestamp so the client can adopt it.
//   If the stored row is older-or-equal, the client wins and the row
//   is upserted with updated_at=Date.now().
//   Rationale: last-writer-wins by wall clock is racy across devices,
//   so "what you last saw" acts as a per-client compare-and-swap.
//
// Guests: local-only. Guests have no durable account, so both routes
// answer 403 — the client must keep using localStorage for them.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { dbRun, dbGet, getUserById } from '../db.js';

export const CLOUD_SAVE_MAX_BYTES = 64 * 1024; // 64KB payload cap

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

async function requireFullUser(req, res) {
  const user = await getUserById(req.userId);
  if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
  if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
  if (Number(user.is_guest)) {
    res.status(403).json({ error: 'Cloud saves are for full accounts — guests stay local-only.' });
    return null;
  }
  return user;
}

export function createCloudSaveRouter() {
  const router = Router();

  // ---- GET /api/cloud-save: load (lazy-create on first hit) ----
  router.get('/cloud-save', authMiddleware, async (req, res) => {
    const user = await requireFullUser(req, res);
    if (!user) return;
    let row = await dbGet(
      'SELECT user_id, payload, updated_at FROM cloud_saves WHERE user_id=?',
      'SELECT user_id, payload, updated_at FROM cloud_saves WHERE user_id=$1',
      [user.id]
    );
    if (!row) {
      const now = Date.now();
      await dbRun(
        'INSERT INTO cloud_saves (user_id, payload, updated_at) VALUES (?,?,?)',
        'INSERT INTO cloud_saves (user_id, payload, updated_at) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING',
        [user.id, '{}', now]
      );
      row = { user_id: user.id, payload: '{}', updated_at: now };
    }
    let payload = {};
    try { payload = JSON.parse(row.payload); } catch { /* fall back to {} */ }
    res.json({ ok: true, payload, updated_at: Number(row.updated_at) });
  });

  // ---- PUT /api/cloud-save: save with conflict detection ----
  router.put('/cloud-save', authMiddleware, async (req, res) => {
    const user = await requireFullUser(req, res);
    if (!user) return;

    const { payload, client_updated_at: clientUpdatedAt } = req.body || {};
    if (!isPlainObject(payload)) {
      return res.status(400).json({ error: 'payload must be a JSON object.' });
    }
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > CLOUD_SAVE_MAX_BYTES) {
      return res.status(413).json({ error: 'Cloud save payload exceeds 64KB.' });
    }
    if (!Number.isFinite(clientUpdatedAt)) {
      return res.status(400).json({ error: 'client_updated_at must be a number.' });
    }

    const row = await dbGet(
      'SELECT payload, updated_at FROM cloud_saves WHERE user_id=?',
      'SELECT payload, updated_at FROM cloud_saves WHERE user_id=$1',
      [user.id]
    );
    const storedUpdatedAt = row ? Number(row.updated_at) : 0;
    const storedPayload = row ? row.payload : '{}';

    // Conflict: server row is newer than what the client last saw, and
    // the payloads differ. Refuse to overwrite; hand the server copy
    // back so the client can adopt it. Identical payloads are not a
    // conflict — the write is redundant, accept it.
    if (row && storedUpdatedAt > clientUpdatedAt && storedPayload !== serialized) {
      let serverPayload = {};
      try { serverPayload = JSON.parse(storedPayload); } catch { /* fall back */ }
      return res.status(409).json({
        error: 'conflict',
        server_payload: serverPayload,
        server_updated_at: storedUpdatedAt,
      });
    }

    const now = Date.now();
    if (row) {
      await dbRun(
        'UPDATE cloud_saves SET payload=?, updated_at=? WHERE user_id=?',
        'UPDATE cloud_saves SET payload=$1, updated_at=$2 WHERE user_id=$3',
        [serialized, now, user.id]
      );
    } else {
      await dbRun(
        'INSERT INTO cloud_saves (user_id, payload, updated_at) VALUES (?,?,?)',
        'INSERT INTO cloud_saves (user_id, payload, updated_at) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING',
        [user.id, serialized, now]
      );
    }
    res.json({ ok: true, updated_at: now });
  });

  return router;
}
