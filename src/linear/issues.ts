/**
 * Issue-related functions for Linear API
 */

import { executeQuery } from "./client.js";
import { listTeams } from "./teams.js";
import { listStates } from "./teams.js";
import { listUsers } from "./users.js";
import { listLabels } from "./labels.js";
import { listProjects } from "./projects.js";

/**
 * Issue type
 */
export interface Issue {
	identifier?: string;
	title?: string;
	state?: string;
	priority?: number;
	projectName?: string | null;
	dueDate?: string | null;
	createdAt?: string;
	updatedAt?: string;
	description?: string | null;
	labels?: string[];
	assigneeName?: string | null;
	creatorName?: string | null;
	summary_by_gemini?: string | null;
}

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
}

/**
 * List issues with optional filtering
 */
export async function listIssues(
	apiKey: string,
	query?: string,
	filter?: {
		teamId?: string;
		assigneeId?: string;
		state?: string;
		priority?: number;
		includeCompleted?: boolean;
		includeBacklog?: boolean;
		updatedAt?: string;
	},
	first = 25,
	options?: QueryOptions,
): Promise<Issue[]> {
	// Build filter object
	const filterObj: Record<string, unknown> = {};
	if (filter?.teamId) filterObj.team = { id: { eq: filter.teamId } };
	if (filter?.assigneeId)
		filterObj.assignee = { id: { eq: filter.assigneeId } };
	if (filter?.state) filterObj.state = { name: { eq: filter.state } };
	if (filter?.priority !== undefined) {
		filterObj.priority = { eq: filter.priority };
	}
	if (filter?.updatedAt) filterObj.updatedAt = { gte: filter.updatedAt };

	// Exclude completed, canceled, and backlog by default
	const excludedTypes: string[] = [];
	if (!filter?.includeCompleted) {
		excludedTypes.push("completed", "canceled");
	}
	if (!filter?.includeBacklog) {
		excludedTypes.push("backlog");
	}

	if (excludedTypes.length > 0) {
		filterObj.state = {
			...(typeof filterObj.state === "object" ? filterObj.state : {}),
			type: { nin: excludedTypes },
		};
	}

	// Add text search to filter if query provided
	if (query) {
		filterObj.or = [
			{ title: { containsIgnoreCase: query } },
			{ description: { containsIgnoreCase: query } },
		];
	}

	const graphqlQuery = `
    query SearchIssues($filter: IssueFilter, $first: Int) {
      issues(filter: $filter, first: $first) {
        nodes {
          identifier
          title
          state { name }
          priority
          project { name }
          dueDate
        }
      }
    }
  `;

	const data = await executeQuery<{
		issues: {
			nodes: Array<{
				identifier: string;
				title: string;
				state: { name: string };
				priority: number;
				project: { name: string } | null;
				dueDate: string | null;
			}>;
		};
	}>(graphqlQuery, { filter: filterObj, first }, apiKey, options);

	return data.issues.nodes.map((issue) => ({
		identifier: issue.identifier,
		title: issue.title,
		state: issue.state.name,
		priority: issue.priority,
		projectName: issue.project?.name || null,
		dueDate: issue.dueDate,
	}));
}

/**
 * Get full issue details
 */
export async function getIssue(
	apiKey: string,
	identifier: string,
	options?: QueryOptions,
): Promise<Issue> {
	const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        identifier
        title
        description
        state { name }
        priority
        assignee { name }
        creator { name }
        labels { nodes { name } }
        project { name }
        dueDate
        createdAt
        updatedAt
      }
    }
  `;

	const data = await executeQuery<{
		issue: {
			identifier: string;
			title: string;
			description: string | null;
			state: { name: string };
			priority: number;
			assignee: { name: string } | null;
			creator: { name: string } | null;
			labels: { nodes: Array<{ name: string }> };
			project: { name: string } | null;
			dueDate: string | null;
			createdAt: string;
			updatedAt: string;
		};
	}>(query, { id: identifier }, apiKey, options);

	return {
		identifier: data.issue.identifier,
		title: data.issue.title,
		state: data.issue.state.name,
		priority: data.issue.priority,
		projectName: data.issue.project?.name || null,
		dueDate: data.issue.dueDate,
		description: data.issue.description,
		labels: data.issue.labels.nodes.map((l) => l.name),
		assigneeName: data.issue.assignee?.name || null,
		createdAt: data.issue.createdAt,
		updatedAt: data.issue.updatedAt,
		creatorName: data.issue.creator?.name || null,
	};
}

/**
 * Create a new issue (internal - uses IDs)
 */
export interface CreateIssueInput {
	teamId: string;
	title: string;
	description?: string;
	priority?: number;
	assigneeId?: string;
	labelIds?: string[];
	projectId?: string;
	stateId?: string;
	dueDate?: string;
}

export interface CreateIssueResult {
	success: boolean;
	issue?: {
		id: string;
		identifier: string;
		title: string;
		url: string;
	};
}

export async function createIssue(
	apiKey: string,
	input: CreateIssueInput,
	options?: QueryOptions,
): Promise<CreateIssueResult> {
	const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;

	const data = await executeQuery<{
		issueCreate: {
			success: boolean;
			issue: {
				id: string;
				identifier: string;
				title: string;
				url: string;
			};
		};
	}>(mutation, { input }, apiKey, options);

	return data.issueCreate;
}

/**
 * Update an existing issue (internal - uses IDs)
 */
export interface UpdateIssueInput {
	issueId: string;
	title?: string;
	description?: string;
	priority?: number;
	assigneeId?: string;
	labelIds?: string[];
	projectId?: string;
	stateId?: string;
	dueDate?: string;
}

export interface UpdateIssueResult {
	success: boolean;
	issue?: {
		id: string;
		identifier: string;
		title: string;
		url: string;
	};
}

export async function updateIssue(
	apiKey: string,
	input: UpdateIssueInput,
	options?: QueryOptions,
): Promise<UpdateIssueResult> {
	const mutation = `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;

	const { issueId, ...updateInput } = input;

	const data = await executeQuery<{
		issueUpdate: {
			success: boolean;
			issue: {
				id: string;
				identifier: string;
				title: string;
				url: string;
			};
		};
	}>(mutation, { id: issueId, input: updateInput }, apiKey, options);

	return data.issueUpdate;
}

/**
 * Helper: Resolve names to IDs
 */
interface NameResolutionInput {
	assigneeName?: string;
	stateName?: string;
	labelNames?: string[];
	projectName?: string;
}

interface NameResolutionResult {
	assigneeId?: string;
	stateId?: string;
	labelIds?: string[];
	projectId?: string;
}

async function resolveNamesToIds(
	apiKey: string,
	teamId: string,
	teamName: string,
	input: NameResolutionInput,
	options?: QueryOptions,
): Promise<NameResolutionResult> {
	// Fetch all resources in parallel
	const [users, states, teamLabels, workspaceLabels, projects] =
		await Promise.all([
			input.assigneeName ? listUsers(apiKey, options) : Promise.resolve([]),
			input.stateName ? listStates(apiKey, teamId, options) : Promise.resolve([]),
			input.labelNames ? listLabels(apiKey, teamId, options) : Promise.resolve([]),
			input.labelNames ? listLabels(apiKey, undefined, options) : Promise.resolve([]),
			input.projectName ? listProjects(apiKey, teamId, false, options) : Promise.resolve([]),
		]);

	const result: NameResolutionResult = {};

	// Resolve assignee
	if (input.assigneeName) {
		const user = users.find((u) => u.name === input.assigneeName);
		if (!user) {
			throw new Error(`User not found: ${input.assigneeName}`);
		}
		result.assigneeId = user.id;
	}

	// Resolve state
	if (input.stateName) {
		const state = states.find((s) => s.name === input.stateName);
		if (!state) {
			throw new Error(
				`State not found in team ${teamName}: ${input.stateName}`,
			);
		}
		result.stateId = state.id;
	}

	// Resolve labels
	if (input.labelNames && input.labelNames.length > 0) {
		const allLabels = [...teamLabels, ...workspaceLabels];
		result.labelIds = [];
		for (const labelName of input.labelNames) {
			const label = allLabels.find((l) => l.name === labelName);
			if (!label) {
				throw new Error(`Label not found: ${labelName}`);
			}
			result.labelIds.push(label.id);
		}
	}

	// Resolve project
	if (input.projectName) {
		const project = projects.find((p) => p.name === input.projectName);
		if (!project) {
			throw new Error(
				`Project not found in team ${teamName}: ${input.projectName}`,
			);
		}
		result.projectId = project.id;
	}

	return result;
}

/**
 * Create a new issue by name (user-friendly API)
 */
export interface CreateIssueByNameInput {
	teamName: string;
	title: string;
	description?: string;
	priority?: number;
	assigneeName?: string;
	labelNames?: string[];
	projectName?: string;
	stateName?: string;
	dueDate?: string;
}

export async function createIssueByName(
	apiKey: string,
	input: CreateIssueByNameInput,
	options?: QueryOptions,
): Promise<CreateIssueResult> {
	// 1. Resolve team name to ID
	const teams = await listTeams(apiKey, options);
	const team = teams.find((t) => t.name === input.teamName);
	if (!team) {
		throw new Error(`Team not found: ${input.teamName}`);
	}

	// 2. Resolve all names to IDs
	const resolved = await resolveNamesToIds(apiKey, team.id, team.name, input, options);

	// 3. Call the ID-based createIssue
	return createIssue(apiKey, {
		teamId: team.id,
		title: input.title,
		description: input.description,
		priority: input.priority,
		dueDate: input.dueDate,
		...resolved,
	}, options);
}

/**
 * Update an existing issue by name (user-friendly API)
 */
export interface UpdateIssueByNameInput {
	identifier: string;
	title?: string;
	description?: string;
	priority?: number;
	assigneeName?: string;
	labelNames?: string[];
	projectName?: string;
	stateName?: string;
	dueDate?: string;
}

export async function updateIssueByName(
	apiKey: string,
	input: UpdateIssueByNameInput,
	options?: QueryOptions,
): Promise<UpdateIssueResult> {
	// 1. Extract team from identifier (format: TEAM-123) and get issue ID
	const teamKey = input.identifier.split("-")[0];
	const teams = await listTeams(apiKey, options);
	const team = teams.find((t) => t.key === teamKey);
	if (!team) {
		throw new Error(`Team not found for identifier: ${input.identifier}`);
	}

	// 2. Get the issue ID
	const issueQuery = `
    query GetIssueId($id: String!) {
      issue(id: $id) {
        id
      }
    }
  `;

	const issueData = await executeQuery<{
		issue: { id: string };
	}>(issueQuery, { id: input.identifier }, apiKey, options);

	// 3. Resolve all names to IDs
	const resolved = await resolveNamesToIds(apiKey, team.id, team.name, input, options);

	// 4. Call the ID-based updateIssue
	return updateIssue(apiKey, {
		issueId: issueData.issue.id,
		title: input.title,
		description: input.description,
		priority: input.priority,
		dueDate: input.dueDate,
		...resolved,
	}, options);
}
