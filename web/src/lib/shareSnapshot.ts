/** Structural sharing for JSON snapshots: unchanged room/avatar subtrees keep
 * their identity, so unrelated need/clock updates cannot rebuild GPU models. */
export function shareSnapshot<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object" ||
      Array.isArray(previous) !== Array.isArray(next)) return next;
  const old = previous as Record<string, unknown>;
  const incoming = next as Record<string, unknown>;
  const keys = Object.keys(incoming);
  const result: Record<string, unknown> = Array.isArray(next) ? [] as unknown as Record<string, unknown> : {};
  let equal = keys.length === Object.keys(old).length;
  for (const key of keys) {
    const value = shareSnapshot(old[key], incoming[key]);
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
    if (!Object.hasOwn(old, key) || !Object.is(value, old[key])) equal = false;
  }
  return equal ? previous : result as T;
}
