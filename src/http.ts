/**
 * The hosted endpoint behind mcp.sourcevine.io.
 *
 * Stateless, and a NEW server and transport are built for every request. That
 * is the whole security model: this process handles many customers' keys, and
 * a server reused across requests would carry one caller's key into another
 * caller's tool invocation. Nothing is cached, nothing is stored, and the key
 * lives only in the closure of the request that supplied it.
 *
 * We never hold a key at rest. It arrives on the request, is forwarded to
 * api.sourcevine.io as a bearer token, and goes out of scope with the
 * response. Running the stdio server locally is still the stronger position
 * and the docs say so.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { DEFAULT_BASE_URL, SourcevineClient } from './client.js';
import { buildServer } from './server.js';

const PORT = Number(process.env.PORT || 9402);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.SOURCEVINE_BASE_URL || DEFAULT_BASE_URL;
const MAX_BODY = 1024 * 1024; // 1MB. A tool call is a URL and two flags.

function bearer(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null;
  // Some MCP clients cannot set an Authorization header on a remote server.
  const direct = req.headers['x-access-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return null;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createHttpServer(baseUrl: string = BASE_URL): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/health') {
      return send(res, 200, { ok: true });
    }
    if (url.pathname !== '/mcp') {
      return send(res, 404, { error: 'Not found. The MCP endpoint is POST /mcp.' });
    }
    // Stateless: there is no stream to resume and no session to terminate.
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(rpcError(null, -32000, 'Use POST for this endpoint.')));
    }

    const apiKey = bearer(req);
    if (!apiKey) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="sourcevine"',
      });
      return res.end(
        JSON.stringify(
          rpcError(null, -32001, 'Send your Sourcevine key as `Authorization: Bearer sv_live_...`.'),
        ),
      );
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, rpcError(null, -32700, 'Malformed or oversized request body.'));
    }

    // Per request, never shared. See the module docstring.
    const server = buildServer(new SourcevineClient(apiKey, baseUrl));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req as never, res, body);
    } catch (error) {
      // Deliberately not echoing the error: it can quote request internals,
      // and this endpoint is public.
      process.stderr.write(`mcp request failed [${randomUUID()}]: ${(error as Error).message}\n`);
      if (!res.headersSent) send(res, 500, rpcError(null, -32603, 'Internal error.'));
    }
  });
}

export const CONFIG = { PORT, HOST, BASE_URL };
