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
// deploy adds it to the box. Requests carry customers' keys, so an event holds
// the error and its stack and nothing else. Monitoring must never stop the
// server: if the import fails, we log it and serve without Sentry.
const redact = (text: string) =>
  text
    .replace(/https?:\/\/[^\s'"]+/g, (url) => url.split(/[?#]/)[0])
    .replace(/sv_live_\S+/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[token]');

let onError: ((error: unknown) => void) | undefined;
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
      release: process.env.SENTRY_RELEASE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      beforeSend(event) {
        delete event.request;
        delete event.user;
        delete event.extra;
        if (event.message) event.message = redact(event.message);
        for (const exception of event.exception?.values ?? []) {
          if (exception.value) exception.value = redact(exception.value);
        }
        return event;
      },
    });
    onError = Sentry.captureException;
  } catch (error) {
    process.stderr.write(`sentry disabled: ${(error as Error).message}\n`);
  }
}

createHttpServer(undefined, onError).listen(CONFIG.PORT, CONFIG.HOST, () => {
  process.stderr.write(
    `sourcevine mcp listening on ${CONFIG.HOST}:${CONFIG.PORT} -> ${CONFIG.BASE_URL}\n`,
  );
});
