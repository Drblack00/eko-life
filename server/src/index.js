// ============================================================
// Èkó Life server entry point — boot and listen.
// ============================================================
import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;

const { start } = await createApp();
await start(PORT);
