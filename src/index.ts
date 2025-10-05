import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

type GitHubAuthProps = {
	authType: "github";
	login: string;
	name: string;
	email: string;
	accessToken: string;
};

type TokenAuthProps = {
	authType: "token";
	tokenId: string;
	label?: string;
};

type Props = GitHubAuthProps | TokenAuthProps;
import {
	searchIssues,
	getIssue,
	createIssueByName,
	updateIssueByName,
	getWorkspaceOverview,
	listTeams,
	listUsers,
	createComment,
	updateComment,
} from "./linear";

// Define our Linear MCP agent
export class LinearLiteMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Linear Lite MCP",
		version: "0.1.0",
	});

	private checkAccess() {
		if (!this.props) {
			throw new Error("Access denied. Missing authentication context.");
		}

		if (this.props.authType === "token") {
			return;
		}

		const allowedUsers = this.env.ALLOWED_GITHUB_USERS?.split(',').map((u) => u.trim()) || [];

		if (allowedUsers.length > 0 && !allowedUsers.includes(this.props.login)) {
			throw new Error(`Access denied. User ${this.props.login} is not authorized.`);
		}
	}

	private getApiKey() {
		this.checkAccess();
		const apiKey = this.env.LINEAR_API_KEY;
		if (!apiKey) {
			throw new Error("LINEAR_API_KEY not configured");
		}
		return apiKey;
	}

	private getGeminiApiKey() {
		this.checkAccess();
		return this.env.GEMINI_API_KEY;
	}

	private handleError(error: unknown) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Error: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
		};
	}

	async init() {
		// Search issues with minimal payload
		this.server.tool(
			"issues_search",
			{
				query: z.string().optional(),
				teamName: z.string().optional(),
				assigneeName: z.string().optional(),
				state: z.string().optional(),
				priority: z.number().int().min(0).max(4).optional(),
				limit: z.number().min(1).max(100).default(25),
				includeCompleted: z.boolean().default(false),
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
				updatedAt,
			}) => {
				try {
					const apiKey = this.getApiKey();

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

					const issues = await searchIssues(
						apiKey,
						query,
						{ teamId, assigneeId, state, priority, includeCompleted, updatedAt },
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

		// Get full issue details with AI summary
		this.server.tool(
			"issue_get",
			{
				identifier: z.string(),
				summarize_by_gemini: z.boolean().default(true),
			},
			async ({ identifier, summarize_by_gemini }) => {
				try {
					const apiKey = this.getApiKey();
					const geminiApiKey = this.getGeminiApiKey();
					const issue = await getIssue(apiKey, identifier, geminiApiKey, summarize_by_gemini);
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
				const apiKey = this.getApiKey();
				const overview = await getWorkspaceOverview(apiKey);

				const cleanedOverview = {
					teams: overview.teams.map(({ id, ...team }) => team),
					workspaceLabels: overview.workspaceLabels,
					initiatives: overview.initiatives,
					users: overview.users.map(({ id, ...user }) => user),
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
			}) => {
				try {
					const apiKey = this.getApiKey();
					const result = await createIssueByName(apiKey, {
						teamName,
						title,
						description,
						priority,
						assigneeName,
						labelNames,
						projectName,
						stateName,
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
			}) => {
				try {
					const apiKey = this.getApiKey();
					const result = await updateIssueByName(apiKey, {
						identifier,
						title,
						description,
						priority,
						assigneeName,
						labelNames,
						projectName,
						stateName,
					});

					return {
						content: [
							{ type: "text", text: JSON.stringify({ success: result.success }, null, 2) },
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
					const apiKey = this.getApiKey();
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
					const apiKey = this.getApiKey();
					const result = await updateComment(apiKey, { commentId, body });
					return {
						content: [
							{ type: "text", text: JSON.stringify({ success: result.success }, null, 2) },
						],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);
	}
}

export default new OAuthProvider({
	apiHandlers: {
		"/mcp": LinearLiteMCP.serve("/mcp"),
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
	resolveExternalToken: async ({ token, env }) => {
		const props = resolveServiceToken(token, env as Env);
		return props ? { props } : null;
	},
});

type ServiceTokenDescriptor = {
	id: string;
	secret: string;
	label: string;
};

function resolveServiceToken(token: string, env: Env): TokenAuthProps | null {
	const descriptors = parseServiceTokenConfig(env);
	if (descriptors.length === 0) {
		return null;
	}

	for (const descriptor of descriptors) {
		if (timingSafeEqual(token, descriptor.secret)) {
			return {
				authType: "token",
				tokenId: descriptor.id,
				label: descriptor.label,
			};
		}
	}

	return null;
}

function parseServiceTokenConfig(env: Env): ServiceTokenDescriptor[] {
	const envRecord = env as unknown as Record<string, string | undefined>;
	const raw = envRecord.MCP_SERVICE_TOKENS;
	if (!raw) {
		return [];
	}

	return raw
		.split(/[\n,]/)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry, index) => {
			const separatorIndex = entry.indexOf(":");
			if (separatorIndex === -1) {
				const id = `token-${index + 1}`;
				return { id, secret: entry, label: id } satisfies ServiceTokenDescriptor;
			}

			const idPart = entry.slice(0, separatorIndex).trim();
			const secretPart = entry.slice(separatorIndex + 1).trim();
			const id = idPart || `token-${index + 1}`;
			return { id, secret: secretPart, label: idPart || id } satisfies ServiceTokenDescriptor;
		})
		.filter((descriptor) => descriptor.secret.length > 0);
}

function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	if (aBytes.length !== bBytes.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < aBytes.length; i += 1) {
		diff |= aBytes[i] ^ bBytes[i];
	}
	return diff === 0;
}
