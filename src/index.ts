import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinearOAuthHandler } from "./oauth/handler.js";
import type { Connection, ConnectionContext } from "agents";

type Props = {
	userId: string;
	name: string;
	email: string;
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
	listTeams,
	listUsers,
	createComment,
	updateComment,
	listDocuments,
	getDocument,
	createDocumentByName,
	updateDocumentByName,
	listProjects,
	listInitiatives,
} from "./linear/index.js";

// Endpoints
const MCP_OAUTH_PATH = "/mcp";
const MCP_NO_OAUTH_PATH = "/mcp-no-oauth";

// Define our Linear MCP agent
export class LinearLiteMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Linear Lite MCP",
		version: "0.1.0",
	});

	private async getApiKey(): Promise<string> {
		if (!this.props) {
			throw new Error(
				"Authentication required. Please authenticate with Linear.",
			);
		}

		// Check if token is expired or about to expire (within 5 minutes)
		const now = Date.now();
		const fiveMinutes = 5 * 60 * 1000;

		if (this.props.expiresAt && now >= this.props.expiresAt - fiveMinutes) {
			// Token expired or about to expire, try to refresh
			if (this.props.refreshToken) {
				await this.refreshAccessToken();
			} else {
				throw new Error(
					"Access token has expired and no refresh token is available. Please re-authenticate with Linear.",
				);
			}
		}

		return this.props.accessToken;
	}

	private async refreshAccessToken(): Promise<void> {
		if (!this.props?.refreshToken) {
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
					refresh_token: this.props.refreshToken,
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

			// Update props with new tokens
			const expiresAt = tokenData.expires_in
				? Date.now() + tokenData.expires_in * 1000
				: undefined;

			const updatedProps = {
				...this.props,
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token || this.props.refreshToken,
				expiresAt,
			};

			// Persist the updated tokens
			await this.updateProps(updatedProps);

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
			// Bearer プレフィックスがあれば除去、なければそのまま使う
			const apiKey = authHeader.startsWith("Bearer ")
				? authHeader.substring(7)
				: authHeader;

			// Set and persist props with the API key (bypass OAuth)
			await this.updateProps({
				userId: "api-key-user",
				name: "API Key User",
				email: "",
				accessToken: apiKey,
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
				priority: z.number().int().min(0).max(4).optional(),
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
					const apiKey = await this.getApiKey();

					// Resolve teamName to teamId if provided
					let teamId: string | undefined;
					if (teamName) {
						const teams = await listTeams(apiKey);
						const team = teams.find((t) => t.name === teamName);
						if (!team) {
							throw new Error(`Team not found: ${teamName}`);
						}
						teamId = team.id;
					}

					// Resolve assigneeName to assigneeId if provided
					let assigneeId: string | undefined;
					if (assigneeName) {
						const users = await listUsers(apiKey);
						const user = users.find((u) => u.name === assigneeName);
						if (!user) {
							throw new Error(`User not found: ${assigneeName}`);
						}
						assigneeId = user.id;
					}

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
					const issue = await getIssue(apiKey, identifier);
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
				const overview = await getWorkspaceOverview(apiKey);

				const cleanedOverview = {
					teams: overview.teams.map(({ id, ...team }) => team),
					workspaceLabels: overview.workspaceLabels,
					initiatives: overview.initiatives,
					users: overview.users.map(({ id, ...user }) => user),
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
				priority: z.number().int().min(0).max(4).optional(),
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
					const result = await createIssueByName(apiKey, {
						teamName,
						title,
						description,
						priority,
						assigneeName: assigneeName || this.props?.name,
						labelNames,
						projectName,
						stateName,
						dueDate,
					});

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
				priority: z.number().int().min(0).max(4).optional(),
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
					const result = await updateIssueByName(apiKey, {
						identifier,
						title,
						description,
						priority,
						assigneeName,
						labelNames,
						projectName,
						stateName,
						dueDate,
					});

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

		// Create comment on issue
		this.server.tool(
			"comment_create",
			{
				identifier: z.string(),
				body: z.string(),
			},
			async ({ identifier, body }) => {
				try {
					const apiKey = await this.getApiKey();
					const result = await createComment(apiKey, { identifier, body });
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// Update comment
		this.server.tool(
			"comment_update",
			{
				commentId: z.string(),
				body: z.string(),
			},
			async ({ commentId, body }) => {
				try {
					const apiKey = await this.getApiKey();
					const result = await updateComment(apiKey, { commentId, body });
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

					// Resolve projectName to projectId if provided
					let projectId: string | undefined;
					if (projectName) {
						const projects = await listProjects(apiKey);
						const project = projects.find((p) => p.name === projectName);
						if (!project) {
							throw new Error(`Project not found: ${projectName}`);
						}
						projectId = project.id;
					}

					// Resolve initiativeName to initiativeId if provided
					let initiativeId: string | undefined;
					if (initiativeName) {
						const initiatives = await listInitiatives(apiKey);
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
					const document = await getDocument(apiKey, slugId);
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
					const result = await createDocumentByName(apiKey, {
						title,
						content,
						projectName,
					});

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
					const result = await updateDocumentByName(apiKey, {
						slugId,
						title,
						content,
						projectName,
						initiativeName,
					});

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
