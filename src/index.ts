import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	searchIssues,
	getIssue,
	createIssueByName,
	updateIssueByName,
	getWorkspaceOverview,
	listTeams,
	listUsers,
	getIssueComments,
	createComment,
	updateComment,
} from "./linear";

// Define our Linear MCP agent
export class LinearLiteMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "Linear Lite MCP",
		version: "0.1.0",
	});

	private getApiKey() {
		const apiKey = this.env.LINEAR_API_KEY;
		if (!apiKey) {
			throw new Error("LINEAR_API_KEY not configured");
		}
		return apiKey;
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

		// Get full issue details
		this.server.tool(
			"issue_get",
			{
				identifier: z.string(),
			},
			async ({ identifier }) => {
				try {
					const apiKey = this.getApiKey();
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

		// Get issue comments
		this.server.tool(
			"issue_comments_get",
			{
				identifier: z.string(),
			},
			async ({ identifier }) => {
				try {
					const apiKey = this.getApiKey();
					const comments = await getIssueComments(apiKey, identifier);
					return {
						content: [{ type: "text", text: JSON.stringify(comments, null, 2) }],
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

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return LinearLiteMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
