# Linear Lite MCP Server

A **lightweight** Linear MCP server on Cloudflare Workers. This implementation uses GraphQL field selection to minimize payload size and avoid UUID floods.

## Design Philosophy

- **Minimal Payload**: Only fetch essential fields in list views
- **Two-Stage Fetch**: Lean lists + detailed gets on demand
- **Flat Structure**: No nested objects (e.g., `assigneeName` instead of `assignee.name`)
- **Type-Safe**: Full TypeScript with Cloudflare Workers types 

## Available Tools

> **Note**: Tool inputs accept human-readable names instead of IDs. The server resolves them to Linear IDs at runtime, so duplicate team/user/label names may lead to ambiguous matches—keep names unique for reliable results.

### `issues_search`
Search issues with minimal payload. Returns only essential fields:
- `identifier`, `title`, `state`, `priority`
- `projectName` (flattened)
- `dueDate`

**Parameters**:
- `query` (optional): Freetext search across title and description
- `teamName` (optional): Filter by team name (resolved to ID server-side)
- `assigneeName` (optional): Filter by assignee name (resolved to ID server-side)
- `state` (optional): Filter by state name
- `priority` (optional): Filter by priority (0-4)
- `limit` (optional): Number of results (1-100, default: 25)
- `includeCompleted` (optional): Include completed/canceled issues (default: false)
- `updatedAt` (optional): Filter by update time using ISO 8601 duration format (e.g., "-P1D" for last 24 hours, "-P7D" for last week)

### `issue_get`
Get full issue details including:
- All fields from lean search
- `description`, `labels`, `assigneeName`, `creatorName`, `createdAt`, `updatedAt`

**Parameters**:
- `identifier` (required): Issue identifier (e.g., "JHS-1")

### `workspace_overview`
Fetch workspace metadata in a single call. Returns:
- Teams with keys, states, labels, and active projects
- Workspace-level labels and initiatives
- Active users (without IDs to keep payload small)

**Parameters**: _None_

### `issue_create`
Create a new issue by human-friendly names. Resolves names to IDs internally before calling Linear.

**Parameters**:
- `teamName` (required): Team to create the issue in
- `title` (required): Issue title
- `description` (optional): Issue description
- `priority` (optional): Priority (0-4)
- `assigneeName` (optional): Assign by user display name
- `labelNames` (optional): Array of label names (team or workspace labels)
- `projectName` (optional): Associate with a project
- `stateName` (optional): Set initial workflow state

**Returns**:
- `success`: Boolean indicating if creation succeeded
- `issue.identifier`: Created issue identifier

### `issue_update`
Update an existing issue by human-friendly names. Resolves names to IDs internally before calling Linear.

**Parameters**:
- `identifier` (required): Issue identifier (e.g., "JHS-1")
- `title` (optional): New title
- `description` (optional): New description
- `priority` (optional): New priority (0-4)
- `assigneeName` (optional): Reassign by user display name
- `labelNames` (optional): Replace labels with new array of label names
- `projectName` (optional): Move to a different project
- `stateName` (optional): Change workflow state

**Returns**:
- `success`: Boolean indicating if update succeeded

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

Server will be available at: `http://localhost:8787/mcp`

> Note: As of MCP protocol version 2024-11-05, the standalone SSE transport is deprecated in favour of Streamable HTTP.<sup>[1](#footnote1)</sup> This server therefore exposes only the Streamable HTTP endpoint at `/mcp`.

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

### Search recently updated issues
```json
{
  "updatedAt": "-P1D",
  "teamName": "Product"
}
```

### Create an issue
```json
{
  "teamName": "Product",
  "title": "API モニタリングを追加",
  "assigneeName": "Daiki",
  "labelNames": ["Backend"],
  "priority": 2
}
```

### Update an issue
```json
{
  "identifier": "JHS-1",
  "stateName": "Done",
  "priority": 1
}
```

### Get issue details
```json
{
  "identifier": "JHS-1"
}
```

### Fetch workspace overview
```json
{}
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
        "http://localhost:8787/mcp"
      ]
    }
  }
}
```

For production, replace with your deployed URL: `https://your-worker.workers.dev/mcp`

---

<a id="footnote1">1</a>: [Model Context Protocol documentation, “Server-Sent Events (SSE) - Deprecated”](https://modelcontextprotocol.io/legacy/concepts/transports#server-sent-events-sse---deprecated).

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

- [x] Issue updates
- [ ] Comment management
- [ ] Project and Initiative search
- [ ] Webhook support for real-time updates
- [ ] Pagination with cursor support 
