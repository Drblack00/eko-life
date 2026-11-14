import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeed, refreshNewsFeeds } from '../src/news.js';

test('news shutdown cancels an in-flight feed and skips subsequent feeds and DB work', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = refreshNewsFeeds({
    feeds: [{ source: 'first', url: 'https://example.com/1' }, { source: 'second', url: 'https://example.com/2' }],
    signal: controller.signal,
    fetchFn: (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    log: { error() { assert.fail('intentional cancellation should be silent'); } },
  });
  controller.abort();
  const result = await pending;
  assert.equal(calls, 1);
  assert.equal(result.stored, 0);
  assert.deepEqual(result.errors, []);
});

test('feed fetch keeps its timeout signal when no lifecycle signal is supplied', async () => {
  await assert.rejects(fetchFeed({ url: 'https://example.com', source: 'test' }, async (_url, { signal }) => {
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    return { ok: false, status: 503 };
  }), /HTTP 503/);
});
