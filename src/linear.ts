/**
 * Lightweight Linear GraphQL client
 */

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
		const errorText = await response.text();
		throw new Error(
			`Linear API error: ${response.status} ${response.statusText}\nResponse: ${errorText}`,
		);
	}

	const json = (await response.json()) as { data: T; errors?: unknown[] };

	if (json.errors) {
		throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
	}

	return json.data;
}

/**
 * Issue type
 */
export interface Issue {
	identifier: string;
	title: string;
	state: string;
	priority: number;
	projectName: string | null;
	dueDate: string | null;
	description?: string | null;
	labels?: string[];
	assigneeName?: string | null;
	createdAt?: string;
	updatedAt?: string;
	creatorName?: string | null;
}

export async function searchIssues(
	apiKey: string,
	query?: string,
	filter?: {
		teamId?: string;
		assigneeId?: string;
		state?: string;
		priority?: number;
		includeCompleted?: boolean;
	},
	first = 25,
): Promise<Issue[]> {
	// Build filter object
	const filterObj: Record<string, unknown> = {};
	if (filter?.teamId) filterObj.team = { id: { eq: filter.teamId } };
	if (filter?.assigneeId) filterObj.assignee = { id: { eq: filter.assigneeId } };
	if (filter?.state) filterObj.state = { name: { eq: filter.state } };
	if (filter?.priority) filterObj.priority = { eq: filter.priority };

	// Exclude completed and canceled by default
	if (!filter?.includeCompleted) {
		filterObj.state = {
			...(typeof filterObj.state === "object" ? filterObj.state : {}),
			type: { nin: ["completed", "canceled"] },
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
export async function getIssue(apiKey: string, identifier: string): Promise<Issue> {
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
	}>(query, { id: identifier }, apiKey);

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

	const data = await executeQuery<{ teams: { nodes: Team[] } }>(query, {}, apiKey);

	return data.teams.nodes;
}

/**
 * List workflow states for a team
 */
export interface State {
	id: string;
	name: string;
	type: string;
}

export async function listStates(apiKey: string, teamId: string): Promise<State[]> {
	const query = `
    query ListStates($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  `;

	const data = await executeQuery<{ team: { states: { nodes: State[] } } }>(
		query,
		{ teamId },
		apiKey,
	);

	return data.team.states.nodes;
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
}

export async function createIssueByName(
	apiKey: string,
	input: CreateIssueByNameInput,
): Promise<CreateIssueResult> {
	// 1. Resolve team name to ID
	const teams = await listTeams(apiKey);
	const team = teams.find((t) => t.name === input.teamName);
	if (!team) {
		throw new Error(`Team not found: ${input.teamName}`);
	}
	const teamId = team.id;

	// 2. Resolve all names to IDs in parallel
	const [users, states, teamLabels, workspaceLabels, projects] = await Promise.all([
		input.assigneeName ? listUsers(apiKey) : Promise.resolve([]),
		input.stateName ? listStates(apiKey, teamId) : Promise.resolve([]),
		input.labelNames ? listLabels(apiKey, teamId) : Promise.resolve([]),
		input.labelNames ? listLabels(apiKey) : Promise.resolve([]),
		input.projectName ? listProjects(apiKey, teamId) : Promise.resolve([]),
	]);

	// Resolve assignee
	let assigneeId: string | undefined;
	if (input.assigneeName) {
		const user = users.find((u) => u.name === input.assigneeName);
		if (!user) {
			throw new Error(`User not found: ${input.assigneeName}`);
		}
		assigneeId = user.id;
	}

	// Resolve state
	let stateId: string | undefined;
	if (input.stateName) {
		const state = states.find((s) => s.name === input.stateName);
		if (!state) {
			throw new Error(`State not found in team ${input.teamName}: ${input.stateName}`);
		}
		stateId = state.id;
	}

	// Resolve labels
	let labelIds: string[] | undefined;
	if (input.labelNames && input.labelNames.length > 0) {
		const allLabels = [...teamLabels, ...workspaceLabels];
		labelIds = [];
		for (const labelName of input.labelNames) {
			const label = allLabels.find((l) => l.name === labelName);
			if (!label) {
				throw new Error(`Label not found: ${labelName}`);
			}
			labelIds.push(label.id);
		}
	}

	// Resolve project
	let projectId: string | undefined;
	if (input.projectName) {
		const project = projects.find((p) => p.name === input.projectName);
		if (!project) {
			throw new Error(`Project not found in team ${input.teamName}: ${input.projectName}`);
		}
		projectId = project.id;
	}

	// 3. Call the ID-based createIssue
	return createIssue(apiKey, {
		teamId,
		title: input.title,
		description: input.description,
		priority: input.priority,
		assigneeId,
		labelIds,
		projectId,
		stateId,
	});
}

/**
 * List users
 */
export interface User {
	id: string;
	name: string;
	active: boolean;
}

export async function listUsers(apiKey: string): Promise<User[]> {
	const query = `
    query ListUsers {
      users {
        nodes {
          id
          name
          active
        }
      }
    }
  `;

	const data = await executeQuery<{ users: { nodes: User[] } }>(query, {}, apiKey);

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

	const data = await executeQuery<{ issueLabels: { nodes: Label[] } }>(
		query,
		{ filter },
		apiKey,
	);

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

export async function listProjects(
	apiKey: string,
	teamId?: string,
	includeCompleted = false,
): Promise<Project[]> {
	if (teamId) {
		// Get projects for a specific team
		const query = `
      query ListTeamProjects($teamId: String!) {
        team(id: $teamId) {
          projects {
            nodes {
              id
              name
              state
            }
          }
        }
      }
    `;

		const data = await executeQuery<{ team: { projects: { nodes: Project[] } } }>(
			query,
			{ teamId },
			apiKey,
		);

		const projects = data.team.projects.nodes;
		return includeCompleted
			? projects
			: projects.filter((p) => p.state !== "completed" && p.state !== "canceled");
	} else {
		// Get all workspace projects
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

		const filter: Record<string, unknown> = {};
		if (!includeCompleted) {
			filter.state = { nin: ["completed", "canceled"] };
		}

		const data = await executeQuery<{ projects: { nodes: Project[] } }>(query, { filter }, apiKey);

		return data.projects.nodes;
	}
}

/**
 * Get workspace overview - all teams, users, labels, states, and projects
 */
export interface WorkspaceOverview {
	teams: Array<{
		id: string;
		name: string;
		key: string;
		states: string[];
		labels: string[];
		projects: string[];
	}>;
	workspaceLabels: string[];
	initiatives: string[];
	users: Array<{
		id: string;
		name: string;
	}>;
}

export async function getWorkspaceOverview(apiKey: string): Promise<WorkspaceOverview> {
	const query = `
    query GetWorkspaceOverview {
      teams {
        nodes {
          id
          name
          key
          states {
            nodes {
              name
            }
          }
          projects {
            nodes {
              name
              state
            }
          }
        }
      }
      issueLabels(filter: { team: { null: true } }) {
        nodes {
          name
        }
      }
      initiatives {
        nodes {
          name
        }
      }
      users(filter: { active: { eq: true } }) {
        nodes {
          id
          name
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
				states: { nodes: Array<{ name: string }> };
				projects: { nodes: Array<{ name: string; state: string }> };
			}>;
		};
		issueLabels: {
			nodes: Array<{ name: string }>;
		};
		initiatives: {
			nodes: Array<{ name: string }>;
		};
		users: {
			nodes: Array<{
				id: string;
				name: string;
			}>;
		};
	}>(query, {}, apiKey);

	// Fetch team-specific labels separately
	const teamsWithLabels = await Promise.all(
		data.teams.nodes.map(async (team) => {
			const teamLabels = await listLabels(apiKey, team.id);
			return {
				id: team.id,
				name: team.name,
				key: team.key,
				states: team.states.nodes.map((s) => s.name),
				labels: teamLabels.map((l) => l.name),
				projects: team.projects.nodes
					.filter((p) => p.state !== "completed" && p.state !== "canceled")
					.map((p) => p.name),
			};
		}),
	);

	return {
		teams: teamsWithLabels,
		workspaceLabels: data.issueLabels.nodes.map((l) => l.name),
		initiatives: data.initiatives.nodes.map((i) => i.name),
		users: data.users.nodes,
	};
}
