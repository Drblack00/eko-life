// ============================================================
// Èkó Life server entry point — boot and listen.
// ============================================================
import { createApp } from './app.js';

// Crash loudly (so Render restarts cleanly) instead of limping on in a
// possibly-corrupted state after an unhandled promise rejection.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;

const { start } = await createApp();
await start(PORT);
