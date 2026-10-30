#!/usr/bin/env node
/**
 * Entry point for the hosted endpoint.
 *
 * Separate from http.ts so that starting the listener is not conditional on
 * an "am I the entry module?" check. That heuristic silently did nothing
 * under a process manager, which looks identical to a healthy process that
 * happens to answer nothing.
 */
import { CONFIG, createHttpServer } from './http.js';

// Hosted endpoint only, and loaded only with a DSN: @sentry/node is a dev
// dependency here, so it never reaches people installing the npm package. The
// deploy adds it to the box. Requests carry customers' keys: no bodies, no PII.
let onError: ((error: unknown) => void) | undefined;
if (process.env.SENTRY_DSN) {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
  });
  onError = Sentry.captureException;
}

createHttpServer(undefined, onError).listen(CONFIG.PORT, CONFIG.HOST, () => {
  process.stderr.write(
    `sourcevine mcp listening on ${CONFIG.HOST}:${CONFIG.PORT} -> ${CONFIG.BASE_URL}\n`,
  );
});
