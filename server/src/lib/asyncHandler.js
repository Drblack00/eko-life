// ============================================================
// asyncHandler.js — Express 4 async safety net
// Express 4 does NOT catch rejected promises from async route handlers:
// a throw inside `async (req, res) => {...}` bypasses error middleware and
// can hang the request or crash the process. This module fixes that in one
// place instead of wrapping ~80 handlers by hand.
//
// - `asyncHandler(fn)` wraps a single async handler (use for new code).
// - `patchExpressAsync()` patches Router.prototype so EVERY async handler
//   registered afterwards is auto-wrapped. Called once at boot in app.js
//   before any route module is loaded.
// ============================================================
import { Router } from 'express';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

/** Wrap one async (req,res,next) handler so rejections reach Express error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function isAsyncFn(h) {
  return typeof h === 'function' && h.constructor && h.constructor.name === 'AsyncFunction';
}

function wrapHandler(h) {
  if (Array.isArray(h)) return h.map(wrapHandler);
  if (isAsyncFn(h)) return asyncHandler(h);
  return h;
}

/**
 * Patch Router.prototype (covers app.get/post/... too, since they delegate
 * to the app's router) so async handlers are auto-wrapped at registration.
 * Idempotent — safe to call once at boot.
 */
export function patchExpressAsync() {
  // Express 4 quirk: Router() instances get the module-exports object as
  // their prototype (via setPrototypeOf), NOT Router.prototype. And
  // app.get/post/... create a Route and call route.get/post/... — so both
  // the router-level and route-level prototypes need patching.
  const routerProto = Object.getPrototypeOf(Router());
  const probeRouter = Router();
  const routeProto = Object.getPrototypeOf(probeRouter.route('/__async_probe__'));
  for (const proto of [routerProto, routeProto]) {
    if (!proto) continue;
    for (const method of [...HTTP_METHODS, 'use']) {
      const orig = proto[method];
      if (typeof orig !== 'function' || orig.__asyncPatched) continue;
      const wrapped = function (...args) {
        // use(path?, ...handlers) and METHOD(path, ...handlers): wrap every
        // function/array arg after an optional leading path.
        const out = args.map((a, i) =>
          i === 0 && (typeof a === 'string' || a instanceof RegExp) ? a : wrapHandler(a)
        );
        return orig.apply(this, out);
      };
      wrapped.__asyncPatched = true;
      proto[method] = wrapped;
    }
  }
}
