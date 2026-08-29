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

createHttpServer().listen(CONFIG.PORT, CONFIG.HOST, () => {
  process.stderr.write(
    `sourcevine mcp listening on ${CONFIG.HOST}:${CONFIG.PORT} -> ${CONFIG.BASE_URL}\n`,
  );
});
