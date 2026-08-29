/**
 * The in-memory tests exercise the tool logic against the real protocol. This
 * one spawns the actual binary on a real pipe, because "compiles" and "boots
 * and speaks stdio" are different claims — and a stray line on stdout breaks
 * the transport rather than showing up as an error.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { APIS } from './client.js';

const ENTRY = new URL('./index.js', import.meta.url).pathname;

type Seen = { url: string; auth?: string };

async function withOrigin<T>(fn: (base: string, seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url!, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Credits-Charged': '1' });
    res.end(
      JSON.stringify({
        success: true,
        available: true,
        data: { username: 'atlas.makes', followerCount: 482300 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`, seen);
  } finally {
    server.close();
  }
}

test('refuses to start without a key, on stderr, with a non-zero exit', async () => {
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH ?? '' } });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise<number | null>((r) => child.on('exit', r));
  assert.equal(code, 1);
  assert.match(stderr, /SOURCEVINE_API_KEY/);
});

test('boots on a real pipe and answers a tool call', async () => {
  await withOrigin(async (base, seen) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      env: { ...process.env, SOURCEVINE_API_KEY: 'sv_live_smoke', SOURCEVINE_BASE_URL: base },
    });
    const client = new Client({ name: 'stdio-test', version: '0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.equal(tools.length, APIS.length);

    const res = (await client.callTool({
      name: 'tiktok_profile',
      arguments: { url: 'https://www.tiktok.com/@atlas.makes' },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.data.followerCount, 482300);
    assert.equal(payload.creditsCharged, 1);

    assert.ok(!seen.some((s) => s.url.includes('sv_live_smoke')), 'key leaked into the URL');
    assert.ok(seen.every((s) => s.auth === 'Bearer sv_live_smoke'));

    await client.close();
  });
});
