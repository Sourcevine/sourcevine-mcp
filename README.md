# @sourcevine/mcp

An MCP server for the [Sourcevine](https://sourcevine.io) public social data
APIs. Gives an assistant one tool per named API — TikTok, Instagram and YouTube
stats, profiles, recent posts and YouTube transcripts.

Read-only. Nothing here posts, follows, messages or changes anything on any
platform, and every tool is annotated `readOnlyHint` so a client can skip a
confirmation it would otherwise be right to show.

## Install

You need a key from [app.sourcevine.io/keys](https://app.sourcevine.io/keys).

Claude Code:

```bash
claude mcp add sourcevine --env SOURCEVINE_API_KEY=sv_live_... -- npx -y @sourcevine/mcp
```

Anything that reads a JSON config:

```json
{
  "mcpServers": {
    "sourcevine": {
      "command": "npx",
      "args": ["-y", "@sourcevine/mcp"],
      "env": { "SOURCEVINE_API_KEY": "sv_live_..." }
    }
  }
}
```

This runs as a local process. Your key sits in your own environment and is
sent to `api.sourcevine.io` when a tool is called.

## Hosted endpoint

If you would rather not run anything, `https://mcp.sourcevine.io/mcp` speaks the
same protocol over Streamable HTTP:

```json
{
  "mcpServers": {
    "sourcevine": {
      "url": "https://mcp.sourcevine.io/mcp",
      "headers": { "Authorization": "Bearer sv_live_..." }
    }
  }
}
```

It is stateless and stores nothing: your key arrives on the request, is
forwarded to the API, and goes out of scope with the response.

Pick whichever suits you. The key is a Sourcevine key and reaches Sourcevine
either way — hosted just adds one hop through our own front door — so this is
a question of whether you want to run a process, not a security trade. Revoke
a key from the dashboard and both routes stop working immediately.

## Tools

| Tool | Credits (live) |
|---|---|
| `tiktok_stats`, `tiktok_profile`, `tiktok_posts`, `tiktok_comments` | 1 |
| `youtube_stats`, `youtube_channel`, `youtube_comments` | 1 |
| `youtube_transcript` | 2 |
| `x_stats`, `x_profile`, `x_posts`, `x_comments` | 1 |
| `instagram_stats`, `instagram_profile` | 2 |
| `instagram_posts` | 4 |
| `instagram_comments` | 8 |

One credit is $0.001 of what the live read costs us upstream. A cache hit costs **0** on all of them, and every result reports what it
actually cost as `creditsCharged`.

The tool list is generated from the API catalog the backend exports, so a tool
cannot exist without a route behind it.

## Things worth knowing

**Leave `cache` alone.** It defaults to cached, and a cache hit is free. An
agent that passes `cache: false` on every call turns a free re-read into a
billed one for nothing.

**Unavailable is not an error.** A private, deleted or unsupported resource
comes back as a normal result with `available: false` and no charge, so an
agent does not sit in a retry loop on a post that no longer exists.

**Use a separate key.** Give the server its own key on its own project. Then
you can see what the assistant spent and revoke it without touching anything
else. An assistant deciding to check two hundred profiles is a normal thing for
an assistant to do.

**No contact data.** No bios, emails, phone numbers, postal addresses or
login-walled data — enforced server-side by an allowlist, not by this package.

## Development

```bash
npm install
npm run build
npm test
```

`src/catalog.json` is generated. Regenerate it from the backend rather than
editing it:

```bash
cd ../sourcevine-backend
manage.py export_catalog --out ../sourcevine-mcp/src/catalog.json
```

## Links

- [Documentation](https://sourcevine.io/docs/mcp/)
- [API reference](https://sourcevine.io/apis/)
- [Issues](https://github.com/Sourcevine/sourcevine-mcp/issues)

## What is in here

`src/index.ts` is the local stdio server this package installs.
`src/http.ts` and `src/serve.ts` are the hosted endpoint at
`mcp.sourcevine.io`. Both share the tool definitions in `src/server.ts` and the
API client in `src/client.ts`, which is why they live together.

How the hosted endpoint is deployed is not in this repo.
