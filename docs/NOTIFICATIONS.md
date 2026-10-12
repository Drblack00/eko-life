# Notifications (M21)

In-app notifications for Èkó Life. Web-push (service-worker push) is
**intentionally later** — this module is architected so the emit point is a
single function, making push a one-line addition.

## Types

| type | icon | fired when |
|---|---|---|
| `friend_online` | 🟢 | A friend's presence flips offline → online. Friends only. |
| `room_message` | 💬 | A message is posted to a chat room you joined (sender skipped). |
| `money_received` | 💸 | Gameplay coins arrive in your wallet from another player. |

Spam guard: `friend_online` has a **per-friend 30-minute cooldown** — at most
one "online" notification per friend per 30 minutes, so login/logout spam
can't flood the panel.

## Where it fires

All emission goes through one function — `server/src/game/notifications.js`:

```js
await notifyUser(ctx, userId, type, { title, body, data });
```

- `friend_online` — `server/src/ws/hub.js` `handleConnect`: on the
  offline→online flip, each friend (with the toggle on) is notified, then the
  live event is pushed to their socket(s).
- `room_message` — `server/src/ws/social.js` `handleRoomChat`: notifies joined
  members except the sender. The client auto-suppresses (marks read, no toast)
  while that room is open.
- `money_received` — `server/src/game/v2/m10.js` shop-buy owner credit:
  when a shop owner earns coins from a sale, the owner is notified.
  **Dormant-ready**: any future P2P transfer path just calls
  `notifyUser(ctx, toUserId, "money_received", {...})` at its completion point.

`notifyUser`:
1. Checks the recipient's prefs (toggle off → skip, no row written).
2. Checks the cooldown for `friend_online` (skip if recent).
3. Writes the `notifications` row.
4. Pushes `notification:new` over the recipient's live socket(s) via the
   hub's broadcast hook.

## Preferences

Per-user toggles (`notification_prefs` table; all default **on**):
`friend_online`, `room_message`, `money_received`.

REST (all behind Bearer <redacted>):

- `GET /api/notifications?limit=30&offset=0` — newest first; returns
  `{ notifications, unread, limit, offset }`.
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/notifications/preferences`
- `PUT /api/notifications/preferences` — body: any subset of the three
  booleans; returns `{ preferences }`.

Client: Me → Settings → Notifications toggles; badge clears when the panel
opens (client calls `openNotifications()` → list + `read-all`).

## WebSocket

Live event pushed to the recipient's open socket(s):

```json
{ "t": "notification:new", "notification": { "id": 12, "type": "friend_online", "title": "...", "body": "...", "data": {...}, "read": false, "created_at": 1728... } }
```

Client (`useGameSocket`): keeps the recent list + unread count, queues a
clickable toast (auto-dismiss 6s), and suppresses room-message toasts while
that room is open.

## Future web-push hook point

To add real push later, extend `notifyUser` in
`server/src/game/notifications.js` right after the row insert (before the
socket push): if the user has a stored push subscription and the pref is on,
`webpush.sendNotification(sub, payload)` with the same
`{ type, title, body, data }` shape. Nothing else changes — the client already
routes all three types to the right screen (Friends, room, wallet).
