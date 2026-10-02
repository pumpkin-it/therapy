// The request being handled, available anywhere further down the call chain (e.g. to record who
// made a change in the audit log) without passing it through every function. Work that doesn't
// come from a signed-in request (scheduled jobs, public signing links) has no user.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

// File uploads (multer) read the request body from the connection's own events, so when multer
// hands on to the route the request context is lost — the audit log would then record no user
// (seen 2026-10-02 on "Mark as signed" with no file attached). Every multer middleware is wrapped
// once, here, to carry on inside the request's context. This module must be loaded before any
// route creates its upload middleware (index.js requires it first).
try {
  const proto = Object.getPrototypeOf(require('multer')());
  const make = proto._makeMiddleware;
  if (typeof make === 'function' && !make.keepsRequestContext) {
    proto._makeMiddleware = function (...args) {
      const mw = make.apply(this, args);
      return (req, res, next) => mw(req, res, err => storage.run(req, () => next(err)));
    };
    proto._makeMiddleware.keepsRequestContext = true;
  }
} catch (e) {
  console.error('requestContext: could not wrap multer:', e.message);
}

module.exports = {
  middleware: (req, res, next) => storage.run(req, next),
  currentUserId: () => storage.getStore()?.user?.id ?? null,
};
