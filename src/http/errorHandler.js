import { Refusal } from '../safety/errors.js';

// Every error leaves as JSON { ok:false, code, message }: a Refusal keeps its
// status and code; anything unexpected is logged and answered 500 INTERNAL.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const send = (status, code, message, extra) => res.status(status).json({ ok: false, code, message, ...extra });
  if (err instanceof Refusal) return send(err.status, err.code, err.message, err.extra);
  if (err.type === 'entity.too.large') return send(413, 'BODY_TOO_LARGE', 'request body is larger than 256 KiB');
  if (err.type === 'entity.parse.failed') return send(400, 'BAD_JSON', 'request body is not valid JSON');
  if (err instanceof URIError) return send(400, 'BAD_REQUEST', 'the request path is not valid percent-encoding');
  console.error('code-skill:', err);
  return send(500, 'INTERNAL', 'internal error (see the plugin log)');
}
