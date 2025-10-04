import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	searchIssuesLean,
	getIssue,
	listTeams,
	createIssue,
	listUsers,
	listLabels,
	listProjects,
} from "./linear";

// Define our Linear MCP agent
export class MyMCP extends McpAgent<Env> {
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
			"issues_search_lean",
			{
				query: z.string().optional(),
				teamId: z.string().optional(),
				assigneeId: z.string().optional(),
				state: z.string().optional(),
				priority: z.number().min(0).max(4).optional(),
				limit: z.number().min(1).max(100).default(25),
			},
			async ({ query, teamId, assigneeId, state, priority, limit }) => {
				try {
					const apiKey = this.getApiKey();
					const issues = await searchIssuesLean(
						apiKey,
						query,
						{ teamId, assigneeId, state, priority },
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
			"issues_get",
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

		// List teams
		this.server.tool("teams_list", {}, async () => {
			try {
				const apiKey = this.getApiKey();
				const teams = await listTeams(apiKey);
				return {
					content: [{ type: "text", text: JSON.stringify(teams, null, 2) }],
				};
			} catch (error) {
				return this.handleError(error);
			}
		});

		// Create issue
		this.server.tool(
			"issues_create",
			{
				teamId: z.string(),
				title: z.string(),
				description: z.string().optional(),
				priority: z.number().min(0).max(4).optional(),
				assigneeId: z.string().optional(),
				labelIds: z.array(z.string()).optional(),
				projectId: z.string().optional(),
			},
			async ({ teamId, title, description, priority, assigneeId, labelIds, projectId }) => {
				try {
					const apiKey = this.getApiKey();
					const result = await createIssue(apiKey, {
						teamId,
						title,
						description,
						priority,
						assigneeId,
						labelIds,
						projectId,
					});
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// List users
		this.server.tool("users_list", {}, async () => {
			try {
				const apiKey = this.getApiKey();
				const users = await listUsers(apiKey);
				return {
					content: [{ type: "text", text: JSON.stringify(users, null, 2) }],
				};
			} catch (error) {
				return this.handleError(error);
			}
		});

		// List labels
		this.server.tool(
			"labels_list",
			{
				teamId: z.string().optional(),
			},
			async ({ teamId }) => {
				try {
					const apiKey = this.getApiKey();
					const labels = await listLabels(apiKey, teamId);
					return {
						content: [{ type: "text", text: JSON.stringify(labels, null, 2) }],
					};
				} catch (error) {
					return this.handleError(error);
				}
			},
		);

		// List projects
		this.server.tool(
			"projects_list",
			{
				teamId: z.string().optional(),
			},
			async ({ teamId }) => {
				try {
					const apiKey = this.getApiKey();
					const projects = await listProjects(apiKey, teamId);
					return {
						content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
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

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
