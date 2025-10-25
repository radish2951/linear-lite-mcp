import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LinearOAuthHandler } from "./linear-oauth-handler";

type Props = {
	userId: string;
	name: string;
	email: string;
	accessToken: string;
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
} from "./linear";

// Define our Linear MCP agent
export class LinearLiteMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Linear Lite MCP",
		version: "0.1.0",
	});

	private getApiKey() {
		if (!this.props) {
			throw new Error(
				"Authentication required. Please authenticate with Linear.",
			);
		}
		return this.props.accessToken;
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
					const apiKey = this.getApiKey();
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
					const apiKey = this.getApiKey();

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
					const apiKey = this.getApiKey();
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
					const apiKey = this.getApiKey();
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
					const apiKey = this.getApiKey();
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

export default new OAuthProvider({
	apiHandlers: {
		"/mcp": LinearLiteMCP.serve("/mcp"),
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: LinearOAuthHandler as any,
	tokenEndpoint: "/token",
});
