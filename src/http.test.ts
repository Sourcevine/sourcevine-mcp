/**
 * The hosted endpoint. The property that matters most is the boring one: this
 * process handles many customers' keys, and one caller's key must never reach
 * another caller's tool invocation.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { APIS } from './client.js';
import { createHttpServer } from './http.js';

type Seen = { auth?: string; url: string };

async function withStack(fn: (endpoint: URL, seen: Seen[]) => Promise<void>): Promise<void> {
  const seen: Seen[] = [];
  const origin = http.createServer((req, res) => {
    seen.push({ auth: req.headers.authorization, url: req.url! });
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Credits-Charged': '1' });
    res.end(JSON.stringify({ success: true, available: true, data: { username: 'a' } }));
  });
  await new Promise<void>((r) => origin.listen(0, r));
  const originPort = (origin.address() as { port: number }).port;

  const mcp = createHttpServer(`http://127.0.0.1:${originPort}`);
  await new Promise<void>((r) => mcp.listen(0, '127.0.0.1', r));
  const mcpPort = (mcp.address() as { port: number }).port;

  try {
    await fn(new URL(`http://127.0.0.1:${mcpPort}/mcp`), seen);
  } finally {
    mcp.close();
    origin.close();
  }
}

function connect(endpoint: URL, key: string) {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: 'http-test', version: '0' });
  return { client, ready: client.connect(transport) };
}

test('health check answers without a key', async () => {
  await withStack(async (endpoint) => {
    const res = await fetch(new URL('/health', endpoint));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('no key is a 401 with a WWW-Authenticate header', async () => {
  await withStack(async (endpoint) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('WWW-Authenticate') ?? '', /Bearer/);
  });
});

test('a real client can list and call tools over HTTP', async () => {
  await withStack(async (endpoint, seen) => {
    const { client, ready } = connect(endpoint, 'sv_live_alice');
    await ready;
    const { tools } = await client.listTools();
    assert.equal(tools.length, APIS.length);

    const res = (await client.callTool({
      name: 'tiktok_profile',
      arguments: { url: 'https://www.tiktok.com/@a' },
    })) as { content: { text: string }[] };
    assert.equal(JSON.parse(res.content[0].text).creditsCharged, 1);
    assert.equal(seen.at(-1)!.auth, 'Bearer sv_live_alice');
    await client.close();
  });
});

test('two callers never borrow each other\'s key', async () => {
  await withStack(async (endpoint, seen) => {
    const alice = connect(endpoint, 'sv_live_alice');
    await alice.ready;
    await alice.client.callTool({ name: 'tiktok_profile', arguments: { url: 'u' } });

    const bob = connect(endpoint, 'sv_live_bob');
    await bob.ready;
    await bob.client.callTool({ name: 'tiktok_profile', arguments: { url: 'u' } });

    // Back to alice, to catch a server that cached the most recent key.
    await alice.client.callTool({ name: 'tiktok_profile', arguments: { url: 'u' } });

    const auths = seen.map((s) => s.auth);
    assert.deepEqual(auths, [
      'Bearer sv_live_alice',
      'Bearer sv_live_bob',
      'Bearer sv_live_alice',
    ]);
    await alice.client.close();
    await bob.client.close();
  });
});

test('GET is refused — stateless, so there is no stream to resume', async () => {
  await withStack(async (endpoint) => {
    const res = await fetch(endpoint, { headers: { Authorization: 'Bearer k' } });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('Allow'), 'POST');
  });
});

test('an unknown path is a 404, not a stack trace', async () => {
  await withStack(async (endpoint) => {
    const res = await fetch(new URL('/admin', endpoint));
    assert.equal(res.status, 404);
  });
});

test('an oversized body is refused', async () => {
  await withStack(async (endpoint) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      body: 'x'.repeat(2 * 1024 * 1024),
    });
    assert.equal(res.status, 400);
  });
});

test('the packaged entry point actually listens', async () => {
  // The previous entry used an "am I the main module?" heuristic that was
  // false under a process manager. The process stayed up and answered
  // nothing, which is indistinguishable from healthy until someone curls it.
  const { spawn } = await import('node:child_process');
  const entry = new URL('./serve.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: '9498', HOST: '127.0.0.1' },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('never announced a listener')), 8000);
      child.stderr.on('data', (d) => {
        if (String(d).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const res = await fetch('http://127.0.0.1:9498/health');
    assert.equal(res.status, 200);
  } finally {
    child.kill();
  }
});
