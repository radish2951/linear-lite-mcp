# Linear Lite MCP Server

A **lightweight** Linear MCP server on Cloudflare Workers. This implementation uses GraphQL field selection to minimize payload size and avoid UUID floods.

## Design Philosophy

- **Minimal Payload**: Only fetch essential fields in list views
- **Two-Stage Fetch**: Lean lists + detailed gets on demand
- **Flat Structure**: No nested objects (e.g., `assigneeName` instead of `assignee.name`)
- **Type-Safe**: Full TypeScript with Cloudflare Workers types 

## Available Tools

> **Note**: Tool inputs accept human-readable names instead of IDs. The server resolves them to Linear IDs at runtime, so duplicate team/user/label names may lead to ambiguous matches—keep names unique for reliable results.

### `issues_list`
List issues with minimal payload. Returns only essential fields:
- `identifier`, `title`, `state`, `priority`
- `projectName` (flattened)
- `dueDate`

**Default behavior**: Excludes both completed/canceled and backlog issues.

**Parameters**:
- `query` (optional): Freetext search across title and description
- `teamName` (optional): Filter by team name (resolved to ID server-side)
- `assigneeName` (optional): Filter by assignee name (resolved to ID server-side)
- `state` (optional): Filter by state name
- `priority` (optional): Filter by priority (0: No Priority, 1: Urgent, 2: High, 3: Medium, 4: Low)
- `limit` (optional): Number of results (1-100, default: 25)
- `includeCompleted` (optional): Include completed/canceled issues (default: false)
- `includeBacklog` (optional): Include backlog issues (default: false)
- `updatedAt` (optional): Filter by update time using ISO 8601 duration format (e.g., "-P1D" for last 24 hours, "-P7D" for last week)

### `issue_get`
Get full issue details.

**Parameters**:
- `identifier` (required): Issue identifier (e.g., "JHS-1")

**Returns**:
- Full issue details: `identifier`, `title`, `state`, `priority`, `projectName`, `dueDate`, `description`, `labels`, `assigneeName`, `creatorName`, `createdAt`, `updatedAt`

### `workspace_overview`
Fetch workspace metadata in a single call. Returns:
- Teams with keys, states, labels, and active projects
- Workspace-level labels and initiatives
- Active users (without IDs to keep payload small)
- **Active issues**: Up to 50 most recently updated issues (excludes completed, canceled, and backlog)

**Parameters**: _None_

### `issue_create`
Create a new issue by human-friendly names. Resolves names to IDs internally before calling Linear.

**Parameters**:
- `teamName` (required): Team to create the issue in
- `title` (required): Issue title
- `description` (optional): Issue description
- `priority` (optional): Issue priority (0: No Priority, 1: Urgent, 2: High, 3: Medium, 4: Low)
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
- `priority` (optional): New priority (0: No Priority, 1: Urgent, 2: High, 3: Medium, 4: Low)
- `assigneeName` (optional): Reassign by user display name
- `labelNames` (optional): Replace labels with new array of label names
- `projectName` (optional): Move to a different project
- `stateName` (optional): Change workflow state

**Returns**:
- `success`: Boolean indicating if update succeeded

### `comment_create`
Create a comment on an issue.

**Parameters**:
- `identifier` (required): Issue identifier (e.g., "JHS-1")
- `body` (required): Comment body in markdown

**Returns**:
- `success`: Boolean indicating if creation succeeded

### `comment_update`
Update an existing comment.

**Parameters**:
- `commentId` (required): Comment ID
- `body` (required): New comment body in markdown

**Returns**:
- `success`: Boolean indicating if update succeeded

### `documents_list`
List documents with minimal payload. Returns only essential fields:
- `title`, `slugId`

**Default behavior**: Excludes archived documents.

**Parameters**:
- `query` (optional): Freetext search by document title (note: content search not supported by Linear API)
- `projectName` (optional): Filter by project name (resolved to ID server-side)
- `initiativeName` (optional): Filter by initiative name (resolved to ID server-side)
- `limit` (optional): Number of results (1-100, default: 25)
- `includeArchived` (optional): Include archived documents (default: false)

### `document_get`
Get full document details including content.

**Parameters**:
- `slugId` (required): Document slug ID (e.g., "roadmap-2024")

**Returns**:
- Full document details: `title`, `slugId`, `url`, `icon`, `color`, `content`, `createdAt`, `updatedAt`, `archivedAt`, `creatorName`, `projectName`, `initiativeName`

### `document_create`
Create a new document by human-friendly names. Resolves names to IDs internally before calling Linear.

**Parameters**:
- `title` (required): Document title
- `projectName` (required): Project to create the document in
- `content` (optional): Document content in markdown

**Returns**:
- `success`: Boolean indicating if creation succeeded
- `document.title`: Created document title
- `document.slugId`: Created document slug ID
- `document.url`: Created document URL

### `document_update`
Update an existing document by human-friendly names. Resolves names to IDs internally before calling Linear.

**Parameters**:
- `slugId` (required): Document slug ID (e.g., "roadmap-2024")
- `title` (optional): New title
- `content` (optional): New content in markdown
- `projectName` (optional): Move to a different project
- `initiativeName` (optional): Associate with an initiative

**Returns**:
- `success`: Boolean indicating if update succeeded

## Setup

### 1. Install dependencies
```bash
pnpm install
```

### 2. Create a Linear OAuth Application

1. Go to https://linear.app/settings/api/applications
2. Click "Create new OAuth Application"
3. Fill in the details:
   - **Name**: Linear Lite MCP Server (or any name you prefer)
   - **Callback URLs**: Add your callback URL(s):
     - For local development: `http://localhost:8787/callback`
     - For production: `https://your-worker-name.workers.dev/callback`
4. Save the application
5. Copy the **Client ID** and **Client Secret** - you'll need these in the next step

### 3. Configure Secrets and Environment Variables

```bash
# For local development (.dev.vars)
cat > .dev.vars << EOF
LINEAR_OAUTH_CLIENT_ID=your_linear_oauth_client_id
LINEAR_OAUTH_CLIENT_SECRET=your_linear_oauth_client_secret
COOKIE_ENCRYPTION_KEY=$(openssl rand -base64 32)
PUBLIC_BASE_URL=http://localhost:8787
EOF

# For production deployment
wrangler secret put LINEAR_OAUTH_CLIENT_ID
wrangler secret put LINEAR_OAUTH_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY
# Also set PUBLIC_BASE_URL as an environment variable (not a secret)
# via the Cloudflare dashboard or wrangler.jsonc
```

**Important**: Each user will authenticate with their own Linear account via OAuth. The server does not use a shared API key.

Get your Linear OAuth credentials at:
- Linear OAuth: https://linear.app/settings/api/applications

### 4. Run locally
```bash
pnpm run dev
```

Server will be available at: `http://localhost:8787/mcp`

> Note: As of MCP protocol version 2024-11-05, the standalone SSE transport is deprecated in favour of Streamable HTTP.<sup>[1](#footnote1)</sup> This server therefore exposes only the Streamable HTTP endpoint at `/mcp`.

### 5. Deploy to Cloudflare
```bash
pnpm run deploy
```

After deployment, don't forget to update your Linear OAuth application's callback URL to include your production URL: `https://your-worker-name.workers.dev/callback`

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

### List documents
```json
{
  "projectName": "Engineering",
  "limit": 10
}
```

### Search documents by title
```json
{
  "query": "roadmap",
  "projectName": "Product"
}
```

### Get document details
```json
{
  "slugId": "roadmap-2024"
}
```

### Create a document
```json
{
  "title": "API Design Guidelines",
  "projectName": "Engineering",
  "content": "# API Design Guidelines\n\n## REST API Standards\n..."
}
```

### Update a document
```json
{
  "slugId": "api-design-guidelines",
  "content": "# Updated API Design Guidelines\n\n## REST API Standards\n...",
  "initiativeName": "Platform Improvement"
}
```

## Authentication Flow

When you first connect to this MCP server from Claude.ai or Claude Desktop:

1. You'll be redirected to the Linear OAuth authorization page
2. Log in with your Linear account and grant permissions
3. You'll be redirected back to the MCP server
4. The server will store your Linear access token securely
5. All subsequent Linear API calls will use your own Linear account

**Each user authenticates with their own Linear account**, so you can only access the Linear workspaces and issues you have permission to view.

## Connect to Claude Web (claude.ai)

1. Go to Claude.ai
2. Click on your profile → Settings → Integrations
3. Add a new MCP server:
   - **URL**: `https://your-worker-name.workers.dev/mcp`
4. Follow the OAuth flow to authenticate with Linear

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

When you first use the server, you'll be prompted to authenticate via OAuth in your browser.

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

- **Authentication**: Linear OAuth 2.0 - each user authenticates with their own Linear account
- **GraphQL Client**: Minimal `fetch`-based implementation (no Apollo overhead)
- **Type Safety**: Full TypeScript with Cloudflare Workers bindings
- **Security**: OAuth tokens stored securely in Durable Objects session storage
- **Rate Limiting**: Respects Linear's rate limits automatically
- **Multi-User**: Supports multiple users, each with their own Linear workspace access

## Future Enhancements

- [x] Issue updates
- [x] Comment management
- [x] Document management (list, get, create, update)
- [ ] Project and Initiative search
- [ ] Webhook support for real-time updates
- [ ] Pagination with cursor support 
