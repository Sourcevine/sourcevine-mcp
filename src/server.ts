/**
 * Tool wiring. One tool per named API, generated from the catalog the backend
 * exports, so an API cannot exist as a route with no tool or a tool with no
 * route.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { APIS, type Api, SourcevineClient, SourcevineError, toolName } from './client.js';

export const VERSION = '0.1.0';

function description(api: Api): string {
  const cost = `${api.credits} credit${api.credits === 1 ? '' : 's'} on a live read, 0 on a cache hit`;
  const shape = api.returnsList
    ? 'Returns a page of items plus nextCursor.'
    : 'Returns one object.';
  return [
    api.summary,
    shape,
    'Fields use this platform\'s own names.',
    `Cost: ${cost}.`,
    'Public data only: no bios, contact details or login-walled data. Read-only.',
  ].join(' ');
}

function inputSchema(api: Api) {
  const base = {
    url: z.string().describe(`A public URL, for example ${api.exampleUrl}`),
    cache: z
      .boolean()
      .optional()
      .describe(
        'Defaults to true. Only pass false when you specifically need a live read — it always costs credits, where a cache hit is free.',
      ),
  };
  if (!api.returnsList) return base;
  return {
    ...base,
    cursor: z.string().optional().describe('nextCursor from a previous page.'),
    limit: z.number().int().min(1).max(50).optional().describe('Items per page.'),
  };
}

export function buildServer(client: SourcevineClient): McpServer {
  const server = new McpServer({ name: 'sourcevine', version: VERSION });

  for (const api of APIS) {
    server.registerTool(
      toolName(api),
      {
        title: api.title,
        description: description(api),
        inputSchema: inputSchema(api),
        annotations: {
          // Nothing in this surface posts, follows, messages or changes
          // anything on any platform. Saying so lets a client skip a
          // confirmation prompt it would otherwise be right to show.
          readOnlyHint: true,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await client.call(api, {
            url: String(args.url),
            cache: args.cache as boolean | undefined,
            cursor: args.cursor as string | undefined,
            limit: args.limit as number | undefined,
          });

          if (!result.available) {
            // The request worked; the thing asked about is gone or private.
            // That is an answer, not a failure — an agent told "error" here
            // would retry a deleted post forever.
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    { available: false, availability: result.availability, creditsCharged: result.creditsCharged },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { data: result.data, creditsCharged: result.creditsCharged },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof SourcevineError
              ? `${error.code}: ${error.message}`
              : (error as Error).message;
          return { isError: true, content: [{ type: 'text' as const, text: message }] };
        }
      },
    );
  }

  return server;
}
