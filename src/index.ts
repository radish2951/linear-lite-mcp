import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinearOAuthHandler } from "./oauth/handler.js";
import type { Connection, ConnectionContext } from "agents";
import { LinearCache } from "./linear/cache.js";
import { encrypt, decrypt } from "./crypto.js";

type Props = {
	userId: string;
	name: string;
	email: string;
};

type LinearTokens = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
};
import {
	listIssues,
	getIssue,
	createIssueByName,
	updateIssueByName,
	getWorkspaceOverview,
	listDocuments,
	getDocument,
	createDocumentByName,
	updateDocumentByName,
} from "./linear/index.js";
import { executeQuery } from "./linear/client.js";

// Endpoints
const MCP_OAUTH_PATH = "/mcp";
const MCP_NO_OAUTH_PATH = "/mcp-no-oauth";

// Define our Linear MCP agent
export class LinearLiteMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Linear Lite MCP",
		version: "0.1.0",
	});

	// Mutex to prevent concurrent refresh requests
	private refreshPromise: Promise<void> | null = null;

	// Cache for frequently accessed Linear data
	private cache = new LinearCache();

	// Track current user to detect switches
	private currentUserId: string | null = null;

	// Linear tokens storage (KV-based, persists across sessions)
	private async getLinearTokens(): Promise<LinearTokens | null> {
		if (!this.props?.userId) {
			return null;
		}
		const key = `linear_tokens:${this.props.userId}`;
		const encryptedData = await this.env.LINEAR_TOKENS_KV.get(key);
		if (!encryptedData) {
			return null;
		}
		try {
			// Decrypt and parse
			const decrypted = await decrypt(encryptedData, this.env.COOKIE_ENCRYPTION_KEY);
			return JSON.parse(decrypted) as LinearTokens;
		} catch (error) {
			console.error("Failed to decrypt/parse tokens from KV:", error);
			return null;
		}
	}

	private async setLinearTokens(tokens: LinearTokens): Promise<void> {
		if (!this.props?.userId) {
			throw new Error("Cannot save tokens: userId not available");
		}
		const key = `linear_tokens:${this.props.userId}`;
		// Encrypt before storing
		const tokensJson = JSON.stringify(tokens);
		const encrypted = await encrypt(tokensJson, this.env.COOKIE_ENCRYPTION_KEY);
		await this.env.LINEAR_TOKENS_KV.put(key, encrypted);
	}

	private async getApiKey(): Promise<string> {
		if (!this.props) {
			throw new Error(
				"Authentication required. Please authenticate with Linear.",
			);
		}

		// Detect user switch and clear cache
		if (this.currentUserId && this.currentUserId !== this.props.userId) {
			console.log("User switch detected, clearing cache...");
			this.cache.clear();
		}
		this.currentUserId = this.props.userId;

		// Get Linear tokens from storage
		const tokens = await this.getLinearTokens();
		if (!tokens?.accessToken) {
			throw new Error(
				"No Linear access token found. Please authenticate with Linear.",
			);
		}

		// Handle legacy sessions without expiresAt
		if (!tokens.expiresAt) {
			if (tokens.refreshToken) {
				// Force refresh to get a proper expiresAt
				console.log("Legacy session detected, forcing token refresh...");
				await this.refreshAccessToken();
				const refreshedTokens = await this.getLinearTokens();
				return refreshedTokens?.accessToken || tokens.accessToken;
			} else {
				// API key mode - set a far future expiration
				await this.setLinearTokens({
					...tokens,
					expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
				});
			}
		}

		// Check if token is expired or about to expire (within 5 minutes)
		const now = Date.now();
		const fiveMinutes = 5 * 60 * 1000;

		if (tokens.expiresAt && now >= tokens.expiresAt - fiveMinutes) {
			// Token expired or about to expire, try to refresh
			if (tokens.refreshToken) {
				await this.refreshAccessToken();
				const refreshedTokens = await this.getLinearTokens();
				return refreshedTokens?.accessToken || tokens.accessToken;
			} else {
				throw new Error(
					"Access token has expired and no refresh token is available. Please re-authenticate with Linear.",
				);
			}
		}

		return tokens.accessToken;
	}

	/**
	 * Get API key with automatic refresh on 401
	 * Used as callback for executeQuery
	 */
	private async refreshAndGetApiKey(): Promise<string> {
		const tokens = await this.getLinearTokens();
		if (!tokens?.refreshToken) {
			throw new Error("No refresh token available for authentication retry");
		}
		await this.refreshAccessToken();
		const refreshedTokens = await this.getLinearTokens();
		if (!refreshedTokens?.accessToken) {
			throw new Error("Failed to get access token after refresh");
		}
		return refreshedTokens.accessToken;
	}

	/**
	 * Execute Linear API query with automatic token refresh
	 * This is the preferred way to call Linear API - it properly handles 401 errors
	 */
	private async executeLinearQuery<T>(
		query: string,
		variables: Record<string, unknown> = {},
	): Promise<T> {
		const apiKey = await this.getApiKey();
		return executeQuery<T>(query, variables, apiKey, {
			onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
		});
	}

	/**
	 * Get teams with caching
	 */
	private async getCachedTeams(): Promise<Array<{ id: string; name: string; key: string }>> {
		return this.cache.getOrFetch("teams", async () => {
			const query = `query ListTeams { teams { nodes { id name key } } }`;
			const data = await this.executeLinearQuery<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(query);
			return data.teams.nodes;
		});
	}

	/**
	 * Get users with caching
	 */
	private async getCachedUsers(): Promise<Array<{ id: string; name: string; active: boolean }>> {
		return this.cache.getOrFetch("users", async () => {
			const query = `query ListUsers { users { nodes { id name active } } }`;
			const data = await this.executeLinearQuery<{ users: { nodes: Array<{ id: string; name: string; active: boolean }> } }>(query);
			return data.users.nodes;
		});
	}

	/**
	 * Get projects with caching
	 */
	private async getCachedProjects(): Promise<Array<{ id: string; name: string }>> {
		return this.cache.getOrFetch("projects", async () => {
			const query = `query ListProjects { projects { nodes { id name } } }`;
			const data = await this.executeLinearQuery<{ projects: { nodes: Array<{ id: string; name: string }> } }>(query);
			return data.projects.nodes;
		});
	}

	/**
	 * Get initiatives with caching
	 */
	private async getCachedInitiatives(): Promise<Array<{ id: string; name: string }>> {
		return this.cache.getOrFetch("initiatives", async () => {
			const query = `query ListInitiatives { initiatives { nodes { id name } } }`;
			const data = await this.executeLinearQuery<{ initiatives: { nodes: Array<{ id: string; name: string }> } }>(query);
			return data.initiatives.nodes;
		});
	}

	private async refreshAccessToken(): Promise<void> {
		// If refresh is already in progress, wait for it
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		// Start refresh and store the promise
		this.refreshPromise = this.performRefresh();

		try {
			await this.refreshPromise;
		} finally {
			// Clear the promise when done
			this.refreshPromise = null;
		}
	}

	private async performRefresh(): Promise<void> {
		const tokens = await this.getLinearTokens();
		if (!tokens?.refreshToken) {
			throw new Error("No refresh token available");
		}

		try {
			const response = await fetch("https://api.linear.app/oauth/token", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: tokens.refreshToken,
					client_id: this.env.LINEAR_OAUTH_CLIENT_ID,
					client_secret: this.env.LINEAR_OAUTH_CLIENT_SECRET,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("Token refresh failed:", errorText);
				throw new Error(
					"Failed to refresh access token. Please re-authenticate with Linear.",
				);
			}

			const tokenData = await response.json<{
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
				token_type: string;
			}>();

			// Update tokens in storage (NOT in props)
			// If Linear doesn't provide expires_in, use 23 hours as conservative default
			const expiresAt = tokenData.expires_in
				? Date.now() + tokenData.expires_in * 1000
				: Date.now() + 23 * 60 * 60 * 1000;

			const updatedTokens: LinearTokens = {
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token || tokens.refreshToken,
				expiresAt,
			};

			// Persist the updated tokens directly to storage
			await this.setLinearTokens(updatedTokens);

			console.log("Access token refreshed successfully");
		} catch (error) {
			console.error("Error refreshing token:", error);
			throw new Error(
				"Failed to refresh access token. Please re-authenticate with Linear.",
			);
		}
	}

	private handleError(error: unknown) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Error: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		};
	}

	async onConnect(conn: Connection, ctx: ConnectionContext): Promise<void> {
		// Check for API key auth on non-OAuth endpoint only
		const url = new URL(ctx.request.url);
		const authHeader = ctx.request.headers.get("Authorization");

		if (url.pathname === MCP_NO_OAUTH_PATH && authHeader) {
			// Require MCP_API_KEY_SECRET for security
			const mcpSecret = ctx.request.headers.get("X-MCP-Secret");
			if (!this.env.MCP_API_KEY_SECRET) {
				throw new Error(
					"MCP_API_KEY_SECRET is not configured. API key mode is disabled.",
				);
			}
			if (!mcpSecret || mcpSecret !== this.env.MCP_API_KEY_SECRET) {
				throw new Error(
					"Invalid or missing X-MCP-Secret header. Unauthorized access.",
				);
			}

			// Bearer プレフィックスがあれば除去、なければそのまま使う
			const apiKey = authHeader.startsWith("Bearer ")
				? authHeader.substring(7)
				: authHeader;

			// Generate unique userId from API key hash
			// This ensures different API keys get separate KV storage
			const encoder = new TextEncoder();
			const data = encoder.encode(apiKey);
			const hashBuffer = await crypto.subtle.digest("SHA-256", data);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const hashHex = hashArray
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
			const apiKeyUserId = `apikey-${hashHex.substring(0, 16)}`;

			// Set props (user info only)
			await this.updateProps({
				userId: apiKeyUserId,
				name: "API Key User",
				email: "",
			});

			// Store API key in Linear tokens storage
			// API keys don't expire, so set a far future expiration
			await this.setLinearTokens({
				accessToken: apiKey,
				expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
			});
		}

		// Always call parent implementation (handles transport setup)
		return super.onConnect(conn, ctx);
	}

	async init() {
		// List issues with minimal payload
		this.server.tool(
			"issues_list",
			{
				query: z.string().optional(),
				teamName: z.string().optional(),
				assigneeName: z.string().optional(),
				state: z.string().optional(),
				priority: z
					.number()
					.int()
					.min(0)
					.max(4)
					.optional()
					.describe(
						"Filter by priority (0: No Priority, 1: Urgent, 2: High, 3: Medium, 4: Low)",
					),
				limit: z.number().min(1).max(100).default(25),
				includeCompleted: z.boolean().default(false),
				includeBacklog: z.boolean().default(false),
				updatedAt: z.string().optional(),
			},
			async ({
				query,
				teamName,
				assigneeName,
				state,
				priority,
				limit,
				includeCompleted,
				includeBacklog,
				updatedAt,
			}) => {
				try {
					// Resolve teamName to teamId if provided (with caching)
					let teamId: string | undefined;
					if (teamName) {
						const teams = await this.getCachedTeams();
						const team = teams.find((t) => t.name === teamName);
						if (!team) {
							throw new Error(`Team not found: ${teamName}`);
						}
						teamId = team.id;
					}

					// Resolve assigneeName to assigneeId if provided (with caching)
					let assigneeId: string | undefined;
					if (assigneeName) {
						const users = await this.getCachedUsers();
						const user = users.find((u) => u.name === assigneeName);
						if (!user) {
							throw new Error(`User not found: ${assigneeName}`);
						}
						assigneeId = user.id;
					}

					const apiKey = await this.getApiKey();
					const issues = await listIssues(
						apiKey,
						query,
						{
							teamId,
							assigneeId,
							state,
							priority,
							includeCompleted,
							includeBacklog,
							updatedAt,
						},
						limit,
						{
							onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
						},
					);
					return {
						content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Get full issue details
		this.server.tool(
			"issue_get",
			{
				identifier: z.string(),
			},
			async ({ identifier }) => {
				try {
					const apiKey = await this.getApiKey();
					const issue = await getIssue(apiKey, identifier, {
						onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
					});
					return {
						content: [{ type: "text", text: JSON.stringify(issue, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Get workspace overview - all teams, users, labels, states, and projects
		this.server.tool("workspace_overview", {}, async () => {
			try {
				const apiKey = await this.getApiKey();
				const overview = await getWorkspaceOverview(apiKey, {
					onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
				});

				const cleanedOverview = {
					teams: overview.teams.map((team: { id: string }) => {
						const { id, ...rest } = team;
						return rest;
					}),
					workspaceLabels: overview.workspaceLabels,
					initiatives: overview.initiatives,
					users: overview.users.map((user: { id: string; name: string }) => {
						const { id, ...rest } = user;
						return rest;
					}),
					activeIssues: overview.activeIssues,
				};

				return {
					content: [
						{ type: "text", text: JSON.stringify(cleanedOverview, null, 2) },
					],
				};
			} catch (error) {
				return this.handleError(error);
			}
		});

		// Create issue by name
		this.server.tool(
			"issue_create",
			{
				teamName: z.string(),
				title: z.string(),
				description: z.string().optional(),
				priority: z
					.number()
					.int()
					.min(0)
					.max(4)
					.optional()
					.describe(
						"Issue priority (0: No Priority, 1: Urgent, 2: High, 3: Medium, 4: Low)",
					),
				assigneeName: z.string().optional(),
				labelNames: z.array(z.string()).optional(),
				projectName: z.string().optional(),
				stateName: z.string().optional(),
				dueDate: z.string().optional(),
			},
			async ({
				teamName,
				title,
				description,
				priority,
				assigneeName,
				labelNames,
				projectName,
				stateName,
				dueDate,
			}) => {
				try {
					const apiKey = await this.getApiKey();
					const result = await createIssueByName(
						apiKey,
						{
							teamName,
							title,
							description,
							priority,
							assigneeName: assigneeName || this.props?.name,
							labelNames,
							projectName,
							stateName,
							dueDate,
						},
						{
							onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
						},
					);

					const cleanedResult = {
						success: result.success,
						issue: result.issue
							? {
								identifier: result.issue.identifier,
							}
							: undefined,
					};

					return {
						content: [
							{ type: "text", text: JSON.stringify(cleanedResult, null, 2) },
						],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Update issue by name
		this.server.tool(
			"issue_update",
			{
				identifier: z.string(),
				title: z.string().optional(),
				description: z.string().optional(),
				priority: z
					.number()
					.int()
					.min(0)
					.max(4)
					.optional()
					.describe(
						"New priority (0: No Priority, 1: Urgent, 2: High, 3: Medium, 4: Low)",
					),
				assigneeName: z.string().optional(),
				labelNames: z.array(z.string()).optional(),
				projectName: z.string().optional(),
				stateName: z.string().optional(),
				dueDate: z.string().optional(),
			},
			async ({
				identifier,
				title,
				description,
				priority,
				assigneeName,
				labelNames,
				projectName,
				stateName,
				dueDate,
			}) => {
				try {
					const apiKey = await this.getApiKey();
					const result = await updateIssueByName(
						apiKey,
						{
							identifier,
							title,
							description,
							priority,
							assigneeName,
							labelNames,
							projectName,
							stateName,
							dueDate,
						},
						{
							onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
						},
					);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ success: result.success }, null, 2),
							},
						],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// List documents
		this.server.tool(
			"documents_list",
			{
				query: z.string().optional(),
				projectName: z.string().optional(),
				initiativeName: z.string().optional(),
				limit: z.number().min(1).max(100).default(25),
				includeArchived: z.boolean().default(false),
			},
			async ({
				query,
				projectName,
				initiativeName,
				limit,
				includeArchived,
			}) => {
				try {
					const apiKey = await this.getApiKey();

					// Resolve projectName to projectId if provided (with caching)
					let projectId: string | undefined;
					if (projectName) {
						const projects = await this.getCachedProjects();
						const project = projects.find((p) => p.name === projectName);
						if (!project) {
							throw new Error(`Project not found: ${projectName}`);
						}
						projectId = project.id;
					}

					// Resolve initiativeName to initiativeId if provided (with caching)
					let initiativeId: string | undefined;
					if (initiativeName) {
						const initiatives = await this.getCachedInitiatives();
						const initiative = initiatives.find(
							(i) => i.name === initiativeName,
						);
						if (!initiative) {
							throw new Error(`Initiative not found: ${initiativeName}`);
						}
						initiativeId = initiative.id;
					}

					const documents = await listDocuments(
						apiKey,
						query,
						{
							projectId,
							initiativeId,
							includeArchived,
						},
						limit,
						{
							onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
						},
					);
					return {
						content: [{ type: "text", text: JSON.stringify(documents, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Get document details
		this.server.tool(
			"document_get",
			{
				slugId: z.string(),
			},
			async ({ slugId }) => {
				try {
					const apiKey = await this.getApiKey();
					const document = await getDocument(apiKey, slugId, {
						onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
					});
					// Remove internal ID from response
					const { id, ...documentWithoutId } = document;
					return {
						content: [{ type: "text", text: JSON.stringify(documentWithoutId, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Create document
		this.server.tool(
			"document_create",
			{
				title: z.string(),
				projectName: z.string(),
				content: z.string().optional(),
			},
			async ({ title, content, projectName }) => {
				try {
					const apiKey = await this.getApiKey();
					const result = await createDocumentByName(
						apiKey,
						{
							title,
							content,
							projectName,
						},
						{
							onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
						},
					);

					const cleanedResult = {
						success: result.success,
						document: result.document
							? {
								title: result.document.title,
								slugId: result.document.slugId,
								url: result.document.url,
							}
							: undefined,
					};

					return {
						content: [
							{ type: "text", text: JSON.stringify(cleanedResult, null, 2) },
						],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Update document
		this.server.tool(
			"document_update",
			{
				slugId: z.string(),
				title: z.string().optional(),
				content: z.string().optional(),
				projectName: z.string().optional(),
				initiativeName: z.string().optional(),
			},
			async ({ slugId, title, content, projectName, initiativeName }) => {
				try {
					const apiKey = await this.getApiKey();
					const result = await updateDocumentByName(
						apiKey,
						{
							slugId,
							title,
							content,
							projectName,
							initiativeName,
						},
						{
							onTokenRefreshNeeded: () => this.refreshAndGetApiKey(),
						},
					);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ success: result.success }, null, 2),
							},
						],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);
	}
}

const oauthProvider = new OAuthProvider({
	apiHandlers: {
		[MCP_OAUTH_PATH]: LinearLiteMCP.serve(MCP_OAUTH_PATH),
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: LinearOAuthHandler as any,
	tokenEndpoint: "/token",
});

const mcpNoOAuthHandler = LinearLiteMCP.serve(MCP_NO_OAUTH_PATH, {
	corsOptions: {
		headers: "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version",
	},
});

// Custom wrapper to handle both OAuth and API key authentication
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Handle non-OAuth endpoint with API key authentication (bypass OAuth provider)
		if (url.pathname === MCP_NO_OAUTH_PATH) {
			return mcpNoOAuthHandler.fetch(request, env, ctx);
		}

		// Handle OAuth-related routes
		if (
			url.pathname === MCP_OAUTH_PATH ||
			url.pathname === "/authorize" ||
			url.pathname === "/callback" ||
			url.pathname === "/token" ||
			url.pathname === "/register"
		) {
			return oauthProvider.fetch(request, env, ctx);
		}

		// Return 404 for unknown routes
		return new Response("Not Found", { status: 404 });
	},
};
