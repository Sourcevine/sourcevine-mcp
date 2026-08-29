#!/usr/bin/env node
/**
 * stdio entry point.
 *
 * There is no hosted endpoint yet. This runs locally, which means the key
 * stays on the machine that owns it rather than being handed to a service.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { DEFAULT_BASE_URL, SourcevineClient } from './client.js';
import { buildServer } from './server.js';

const apiKey = process.env.SOURCEVINE_API_KEY;
if (!apiKey) {
  // stderr, not stdout: stdout is the protocol channel, and a stray line on it
  // breaks the client rather than telling anyone what is wrong.
  process.stderr.write(
    'SOURCEVINE_API_KEY is not set. Create a key at https://app.sourcevine.io/keys\n',
  );
  process.exit(1);
}

const client = new SourcevineClient(
  apiKey,
  process.env.SOURCEVINE_BASE_URL || DEFAULT_BASE_URL,
);

const server = buildServer(client);
await server.connect(new StdioServerTransport());
