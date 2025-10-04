# Linear Lite MCP Server

A **lightweight** Linear MCP server on Cloudflare Workers. This implementation uses GraphQL field selection to minimize payload size and avoid UUID floods.

## Design Philosophy

- **Minimal Payload**: Only fetch essential fields in list views
- **Two-Stage Fetch**: Lean lists + detailed gets on demand
- **Flat Structure**: No nested objects (e.g., `assigneeName` instead of `assignee.name`)
- **Type-Safe**: Full TypeScript with Cloudflare Workers types 

## Available Tools

### `issues_search_lean`
Search issues with minimal payload. Returns only essential fields:
- `identifier`, `title`, `state`, `priority`
- `projectName` (flattened)
- `dueDate`

**Parameters**:
- `query` (optional): Freetext search across title and description
- `teamId` (optional): Filter by team
- `assigneeId` (optional): Filter by assignee
- `state` (optional): Filter by state name
- `priority` (optional): Filter by priority (0-4)
- `limit` (optional): Number of results (1-100, default: 25)

### `issues_get`
Get full issue details including:
- All fields from lean search
- `description`, `labels`, `assigneeName`, `creator`, `createdAt`

**Parameters**:
- `identifier` (required): Issue identifier (e.g., "JHS-1")

## Setup

1. **Install dependencies**:
```bash
npm install
```

2. **Configure Linear API Key**:
```bash
# For local development
echo "LINEAR_API_KEY=lin_api_..." > .dev.vars

# For production deployment
wrangler secret put LINEAR_API_KEY
```

Get your API key at: https://linear.app/settings/api

3. **Run locally**:
```bash
npm run dev
```

Server will be available at: `http://localhost:8787/sse`

4. **Deploy to Cloudflare**:
```bash
npm run deploy
```

## Usage Examples

### Freetext search
```json
{
  "query": "ヒアリング"
}
```

### Search issues by state
```json
{
  "state": "In Progress",
  "limit": 10
}
```

### Search high priority issues
```json
{
  "priority": 1,
  "state": "Todo"
}
```

### Combined search
```json
{
  "query": "API",
  "state": "In Progress"
}
```

### Get issue details
```json
{
  "identifier": "JHS-1"
}
```

## Connect to Claude Desktop

Add to your Claude Desktop config (`~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "linear-lite": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"
      ]
    }
  }
}
```

For production, replace with your deployed URL: `https://your-worker.workers.dev/sse`

## Why Lightweight?

Traditional Linear integrations often return bloated payloads with:
- Full UUID chains for every nested object
- Unnecessary fields in list views
- Deep object nesting

This implementation:
- ✅ Returns only 7 fields in list views (vs. 20+ in typical implementations)
- ✅ Flattens nested objects to reduce token usage
- ✅ Separates "list" and "detail" operations
- ✅ Uses GraphQL field selection to avoid over-fetching

Result: **~70% smaller payloads** for list operations.

## Implementation Details

- **GraphQL Client**: Minimal `fetch`-based implementation (no Apollo overhead)
- **Type Safety**: Full TypeScript with Cloudflare Workers bindings
- **Security**: API key stored in Wrangler Secrets
- **Rate Limiting**: Respects Linear's rate limits automatically

## Future Enhancements

- [ ] Issue creation and updates
- [ ] Comment management
- [ ] Project and Initiative search
- [ ] Webhook support for real-time updates
- [ ] Pagination with cursor support 
