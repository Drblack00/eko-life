/** Preserve message order while coalescing a network burst into one React batch. */
export function createFrameInbox<T>(consume: (message: T) => void) {
  let pending: T[] = [];
  let frame: number | null = null;
  let timer: number | null = null;
  const unschedule = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) window.clearTimeout(timer);
    frame = timer = null;
  };
  const flush = () => {
    unschedule();
    const messages = pending;
    pending = [];
    for (const message of messages) consume(message);
  };
  return {
    push(message: T) {
      pending.push(message);
      if (frame === null) {
        frame = requestAnimationFrame(flush);
        // requestAnimationFrame pauses in hidden tabs; social messages must not.
        timer = window.setTimeout(flush, 50);
      }
    },
    flush,
    clear() { pending = []; unschedule(); },
  };
}
