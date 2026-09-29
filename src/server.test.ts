/**
 * Most of these assert the boring guarantees, because those are the ones an
 * agent will find the hard way: the key is not in a URL, an unavailable
 * resource is not an error, and nothing here can write.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { APIS, SourcevineClient, SourcevineError, toolName } from './client.js';
import { buildServer } from './server.js';

type Captured = { url: string; init: RequestInit };

function stubFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: Captured[] = [];
  const impl = (async (url: string | URL, requestInit: RequestInit) => {
    calls.push({ url: String(url), init: requestInit });
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const PROFILE = APIS.find((a) => a.slug === 'tiktok-profile')!;
const POSTS = APIS.find((a) => a.slug === 'tiktok-posts')!;

// ── the catalog is the tool list ────────────────────────────────────────────

test('every catalog API becomes a tool', async () => {
  const { impl } = stubFetch({ success: true, available: true, data: {} });
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const { tools } = await client.listTools();
  assert.equal(tools.length, APIS.length);
  assert.ok(tools.find((t) => t.name === 'youtube_transcript'));
  await client.close();
});

test('tool names are protocol-legal', () => {
  for (const api of APIS) {
    assert.match(toolName(api), /^[a-z0-9_]+$/, `${api.slug} produced an illegal name`);
  }
});

test('every tool is annotated read-only', async () => {
  const { impl } = stubFetch({ success: true, available: true, data: {} });
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is not marked read-only`);
  }
  await client.close();
});

test('the description states the cost', async () => {
  const { impl } = stubFetch({ success: true, available: true, data: {} });
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const tool = (await client.listTools()).tools.find((t) => t.name === 'youtube_transcript')!;
  assert.match(tool.description!, /2 credits on a live read, 0 on a cache hit/);
  await client.close();
});

// ── the key never travels in a URL ──────────────────────────────────────────

test('the key is sent as a header, never a query parameter', async () => {
  const { impl, calls } = stubFetch({ success: true, available: true, data: {} });
  await new SourcevineClient('sv_live_secret', 'https://x', impl).call(PROFILE, {
    url: 'https://www.tiktok.com/@a',
  });
  assert.ok(!calls[0].url.includes('sv_live_secret'), 'the key leaked into the URL');
  assert.ok(!calls[0].url.includes('access_key'));
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    'Bearer sv_live_secret',
  );
});

// ── cache defaults ──────────────────────────────────────────────────────────

test('cache is left alone unless explicitly disabled', async () => {
  const { impl, calls } = stubFetch({ success: true, available: true, data: {} });
  const client = new SourcevineClient('k', 'https://x', impl);
  await client.call(PROFILE, { url: 'u' });
  assert.ok(!calls[0].url.includes('cache='), 'sent cache= when it did not need to');

  await client.call(PROFILE, { url: 'u', cache: true });
  assert.ok(!calls[1].url.includes('cache='), 'cache:true should send nothing — the default is cached');

  await client.call(PROFILE, { url: 'u', cache: false });
  assert.ok(calls[2].url.includes('cache=false'));
});

test('list APIs pass a cursor through', async () => {
  const { impl, calls } = stubFetch({ success: true, available: true, data: { items: [] } });
  await new SourcevineClient('k', 'https://x', impl).call(POSTS, { url: 'u', cursor: 'abc' });
  assert.ok(calls[0].url.includes('cursor=abc'));
});

// ── unavailable is an answer, not a failure ─────────────────────────────────

test('a deleted resource is a normal result, not an error', async () => {
  const { impl } = stubFetch({
    success: true,
    available: false,
    data: null,
    availability: { status: 'not_found', reason: null },
  }, { headers: { 'X-Credits-Charged': '1' } });
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const res: any = await client.callTool({
    name: 'tiktok_profile',
    arguments: { url: 'https://www.tiktok.com/@gone' },
  });
  assert.notEqual(res.isError, true, 'an agent told "error" here retries a deleted post forever');
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.available, false);
  // Not found is charged like any lookup (2026-09-29); report the header, never a hardcoded 0.
  assert.equal(payload.creditsCharged, 1);
  await client.close();
});

test('an auth failure is surfaced as a tool error', async () => {
  const { impl } = stubFetch(
    { success: false, error: { code: 'unauthenticated', message: 'Invalid or revoked API key.' } },
    { status: 401 },
  );
  const server = buildServer(new SourcevineClient('bad', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const res: any = await client.callTool({
    name: 'tiktok_profile',
    arguments: { url: 'https://www.tiktok.com/@a' },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unauthenticated/);
  await client.close();
});

// ── spend is visible ────────────────────────────────────────────────────────

test('credits charged are reported back to the caller', async () => {
  const { impl } = stubFetch(
    { success: true, available: true, data: { username: 'a' } },
    { headers: { 'X-Credits-Charged': '2' } },
  );
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const res: any = await client.callTool({
    name: 'tiktok_profile',
    arguments: { url: 'https://www.tiktok.com/@a' },
  });
  assert.equal(JSON.parse(res.content[0].text).creditsCharged, 2);
  await client.close();
});

test('an unreachable host says so rather than throwing a bare TypeError', async () => {
  const impl = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => new SourcevineClient('k', 'https://x', impl).call(PROFILE, { url: 'u' }),
    (e: unknown) => e instanceof SourcevineError && e.code === 'unreachable',
  );
});

test('every comments API offers a cursor, because it returns nextCursor', async () => {
  const { impl } = stubFetch({ success: true, available: true, data: {} });
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);

  const { tools } = await client.listTools();
  const comments = tools.filter((t) => t.name.endsWith('_comments'));
  assert.ok(comments.length >= 4);
  for (const t of comments) {
    assert.ok('cursor' in (t.inputSchema.properties ?? {}), `${t.name} cannot page`);
  }
  await client.close();
});

test('an upstream failure passes its availability status on, not a bare HTTP code', async () => {
  const { impl } = stubFetch(
    { success: true, available: false, data: null,
      availability: { status: 'upstream_unavailable', reason: 'provider timed out' } },
    { status: 503 },
  );
  await assert.rejects(
    new SourcevineClient('k', 'https://x', impl).call(PROFILE, { url: 'https://www.tiktok.com/@a' }),
    (e: SourcevineError) => e.code === 'upstream_unavailable' && e.message === 'provider timed out',
  );
});

test('the server announces the package version', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { impl } = stubFetch({ success: true, available: true, data: {} });
  const server = buildServer(new SourcevineClient('k', 'https://x', impl));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  assert.equal(client.getServerVersion()?.version, pkg.version);
  await client.close();
});
