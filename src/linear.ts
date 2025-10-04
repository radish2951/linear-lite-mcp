/**
 * Lightweight Linear GraphQL client
 */

export interface LinearConfig {
	apiKey: string;
}

const LINEAR_API_URL = "https://api.linear.app/graphql";

/**
 * Execute a GraphQL query against Linear API
 */
async function executeQuery<T>(
	query: string,
	variables: Record<string, unknown>,
	apiKey: string,
): Promise<T> {
	const response = await fetch(LINEAR_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: apiKey,
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
	}

	const json = (await response.json()) as { data: T; errors?: unknown[] };

	if (json.errors) {
		throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
	}

	return json.data;
}

/**
 * Lean issue search - minimal payload
 */
export interface IssueLean {
	identifier: string;
	title: string;
	state: string;
	priority: number;
	projectName: string | null;
	dueDate: string | null;
}

export async function searchIssuesLean(
	apiKey: string,
	query?: string,
	filter?: {
		teamId?: string;
		assigneeId?: string;
		state?: string;
		priority?: number;
	},
	first = 25,
): Promise<IssueLean[]> {
	// Build filter object
	const filterObj: Record<string, unknown> = {};
	if (filter?.teamId) filterObj.team = { id: { eq: filter.teamId } };
	if (filter?.assigneeId) filterObj.assignee = { id: { eq: filter.assigneeId } };
	if (filter?.state) filterObj.state = { name: { eq: filter.state } };
	if (filter?.priority) filterObj.priority = { eq: filter.priority };

	// Add text search to filter if query provided
	if (query) {
		filterObj.or = [
			{ title: { containsIgnoreCase: query } },
			{ description: { containsIgnoreCase: query } },
		];
	}

	const graphqlQuery = `
    query SearchIssuesLean($filter: IssueFilter, $first: Int) {
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
	}>(graphqlQuery, { filter: filterObj, first }, apiKey);

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
export interface IssueDetail extends IssueLean {
	description: string | null;
	labels: string[];
	assigneeName: string | null;
	createdAt: string;
	creatorName: string | null;
}

export async function getIssue(apiKey: string, identifier: string): Promise<IssueDetail> {
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
		};
	}>(query, { id: identifier }, apiKey);

	return {
		identifier: data.issue.identifier,
		title: data.issue.title,
		description: data.issue.description,
		state: data.issue.state.name,
		priority: data.issue.priority,
		projectName: data.issue.project?.name || null,
		dueDate: data.issue.dueDate,
		assigneeName: data.issue.assignee?.name || null,
		creatorName: data.issue.creator?.name || null,
		labels: data.issue.labels.nodes.map((l) => l.name),
		createdAt: data.issue.createdAt,
	};
}

/**
 * List teams
 */
export interface Team {
	id: string;
	name: string;
	key: string;
}

export async function listTeams(apiKey: string): Promise<Team[]> {
	const query = `
    query ListTeams {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `;

	const data = await executeQuery<{
		teams: {
			nodes: Array<{
				id: string;
				name: string;
				key: string;
			}>;
		};
	}>(query, {}, apiKey);

	return data.teams.nodes;
}

/**
 * Create a new issue
 */
export interface CreateIssueInput {
	teamId: string;
	title: string;
	description?: string;
	priority?: number;
	assigneeId?: string;
	labelIds?: string[];
	projectId?: string;
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
	}>(mutation, { input }, apiKey);

	return data.issueCreate;
}

/**
 * List users
 */
export interface User {
	id: string;
	name: string;
	email: string;
	active: boolean;
}

export async function listUsers(apiKey: string): Promise<User[]> {
	const query = `
    query ListUsers {
      users {
        nodes {
          id
          name
          email
          active
        }
      }
    }
  `;

	const data = await executeQuery<{
		users: {
			nodes: Array<{
				id: string;
				name: string;
				email: string;
				active: boolean;
			}>;
		};
	}>(query, {}, apiKey);

	return data.users.nodes;
}

/**
 * List labels for a team
 */
export interface Label {
	id: string;
	name: string;
	color: string;
}

export async function listLabels(apiKey: string, teamId?: string): Promise<Label[]> {
	const query = `
    query ListLabels($filter: IssueLabelFilter) {
      issueLabels(filter: $filter) {
        nodes {
          id
          name
          color
        }
      }
    }
  `;

	const filter = teamId ? { team: { id: { eq: teamId } } } : {};

	const data = await executeQuery<{
		issueLabels: {
			nodes: Array<{
				id: string;
				name: string;
				color: string;
			}>;
		};
	}>(query, { filter }, apiKey);

	return data.issueLabels.nodes;
}

/**
 * List projects for a team
 */
export interface Project {
	id: string;
	name: string;
	state: string;
}

export async function listProjects(apiKey: string, teamId?: string): Promise<Project[]> {
	const query = `
    query ListProjects($filter: ProjectFilter) {
      projects(filter: $filter) {
        nodes {
          id
          name
          state
        }
      }
    }
  `;

	const filter = teamId ? { team: { id: { eq: teamId } } } : {};

	const data = await executeQuery<{
		projects: {
			nodes: Array<{
				id: string;
				name: string;
				state: string;
			}>;
		};
	}>(query, { filter }, apiKey);

	return data.projects.nodes;
}
