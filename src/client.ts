/**
 * The HTTP half. Kept apart from the tool wiring so it can be tested without
 * standing up a protocol server.
 */
import catalog from './catalog.json' with { type: 'json' };

export type Api = (typeof catalog.apis)[number];

export const APIS: Api[] = catalog.apis;

export const DEFAULT_BASE_URL = 'https://api.sourcevine.io';

/** MCP tool names allow [a-z0-9_-]; our slugs are hyphenated. */
export const toolName = (api: Api) => api.slug.replace(/-/g, '_');

export class SourcevineError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export interface CallResult {
  /** The per-platform object, or null when the resource is unavailable. */
  data: unknown;
  available: boolean;
  availability?: unknown;
  /** Straight from X-Credits-Charged. Surfaced because an assistant looping
   *  over profiles is a normal thing for an assistant to do, and the person
   *  paying should be able to see it in the transcript. */
  creditsCharged: number | null;
  requestId: string | null;
}

export interface CallOptions {
  url: string;
  cache?: boolean;
  cursor?: string;
  limit?: number;
}

export class SourcevineClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call(api: Api, options: CallOptions): Promise<CallResult> {
    const params = new URLSearchParams({ url: options.url });
    // Only sent when explicitly false. The default is cached, and a cache hit
    // costs nothing — an agent that sends cache=true on every call would turn
    // a free re-read into a billed one for no gain.
    if (options.cache === false) params.set('cache', 'false');
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${api.path}?${params}`, {
        method: 'GET',
        headers: {
          // A header, never the access_key query parameter. The API accepts
          // both; a key in a URL ends up in proxy logs and shell history, and
          // nothing here is a browser that cannot set a header.
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
      });
    } catch (cause) {
      throw new SourcevineError(
        `Could not reach ${this.baseUrl}: ${(cause as Error).message}`,
        'unreachable',
      );
    }

    const creditsHeader = response.headers.get('X-Credits-Charged');
    const body = (await response.json().catch(() => null)) as
      | { success?: boolean; available?: boolean; data?: unknown; availability?: unknown; error?: { code?: string; message?: string } }
      | null;

    if (!response.ok || body?.success === false) {
      const code = body?.error?.code ?? `http_${response.status}`;
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      throw new SourcevineError(message, code);
    }

    return {
      data: body?.data ?? null,
      available: body?.available !== false,
      availability: body?.availability,
      creditsCharged: creditsHeader === null ? null : Number(creditsHeader),
      requestId: response.headers.get('X-Request-Id'),
    };
  }
}
