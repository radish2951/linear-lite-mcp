import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchIssuesLean, getIssue } from "./linear";

// Define our Linear MCP agent
export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "Linear Lite MCP",
		version: "0.1.0",
	});

	async init() {
		// Search issues with minimal payload
		this.server.tool(
			"issues_search_lean",
			{
				teamId: z.string().optional(),
				assigneeId: z.string().optional(),
				state: z.string().optional(),
				priority: z.number().min(0).max(4).optional(),
				limit: z.number().min(1).max(100).default(25),
			},
			async ({ teamId, assigneeId, state, priority, limit }) => {
				const apiKey = this.env.LINEAR_API_KEY;
				if (!apiKey) {
					return {
						content: [{ type: "text", text: "Error: LINEAR_API_KEY not configured" }],
					};
				}

				try {
					const issues = await searchIssuesLean(
						apiKey,
						{ teamId, assigneeId, state, priority },
						limit,
					);
					return {
						content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Error: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
					};
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
				const apiKey = this.env.LINEAR_API_KEY;
				if (!apiKey) {
					return {
						content: [{ type: "text", text: "Error: LINEAR_API_KEY not configured" }],
					};
				}

				try {
					const issue = await getIssue(apiKey, identifier);
					return {
						content: [{ type: "text", text: JSON.stringify(issue, null, 2) }],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Error: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
					};
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
