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
	const authorizationHeader = apiKey.startsWith("Bearer ")
		? apiKey
		: `Bearer ${apiKey}`;

	const response = await fetch(LINEAR_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: authorizationHeader,
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		const errorText = await response.text();

		// Handle rate limiting with Retry-After header
		if (response.status === 429) {
			const retryAfter = response.headers.get("Retry-After");
			const waitTime = retryAfter ? `${retryAfter} seconds` : "a while";
			throw new Error(
				`Linear API rate limit exceeded. Please retry after ${waitTime}.`,
			);
		}

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
export async function getIssue(
	apiKey: string,
	identifier: string,
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

	const data = await executeQuery<{ teams: { nodes: Team[] } }>(
		query,
		{},
		apiKey,
	);

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

export async function listStates(
	apiKey: string,
	teamId: string,
): Promise<State[]> {
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
	}>(mutation, { id: issueId, input: updateInput }, apiKey);

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
): Promise<NameResolutionResult> {
	// Fetch all resources in parallel
	const [users, states, teamLabels, workspaceLabels, projects] =
		await Promise.all([
			input.assigneeName ? listUsers(apiKey) : Promise.resolve([]),
			input.stateName ? listStates(apiKey, teamId) : Promise.resolve([]),
			input.labelNames ? listLabels(apiKey, teamId) : Promise.resolve([]),
			input.labelNames ? listLabels(apiKey) : Promise.resolve([]),
			input.projectName ? listProjects(apiKey, teamId) : Promise.resolve([]),
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
): Promise<CreateIssueResult> {
	// 1. Resolve team name to ID
	const teams = await listTeams(apiKey);
	const team = teams.find((t) => t.name === input.teamName);
	if (!team) {
		throw new Error(`Team not found: ${input.teamName}`);
	}

	// 2. Resolve all names to IDs
	const resolved = await resolveNamesToIds(apiKey, team.id, team.name, input);

	// 3. Call the ID-based createIssue
	return createIssue(apiKey, {
		teamId: team.id,
		title: input.title,
		description: input.description,
		priority: input.priority,
		dueDate: input.dueDate,
		...resolved,
	});
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
): Promise<UpdateIssueResult> {
	// 1. Extract team from identifier (format: TEAM-123) and get issue ID
	const teamKey = input.identifier.split("-")[0];
	const teams = await listTeams(apiKey);
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
	}>(issueQuery, { id: input.identifier }, apiKey);

	// 3. Resolve all names to IDs
	const resolved = await resolveNamesToIds(apiKey, team.id, team.name, input);

	// 4. Call the ID-based updateIssue
	return updateIssue(apiKey, {
		issueId: issueData.issue.id,
		title: input.title,
		description: input.description,
		priority: input.priority,
		dueDate: input.dueDate,
		...resolved,
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

	const data = await executeQuery<{ users: { nodes: User[] } }>(
		query,
		{},
		apiKey,
	);

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

export async function listLabels(
	apiKey: string,
	teamId?: string,
): Promise<Label[]> {
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
 * List initiatives
 */
export interface Initiative {
	id: string;
	name: string;
}

export async function listInitiatives(apiKey: string): Promise<Initiative[]> {
	const query = `
    query ListInitiatives {
      initiatives {
        nodes {
          id
          name
        }
      }
    }
  `;

	const data = await executeQuery<{ initiatives: { nodes: Initiative[] } }>(
		query,
		{},
		apiKey,
	);

	return data.initiatives.nodes;
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

		const data = await executeQuery<{
			team: { projects: { nodes: Project[] } };
		}>(query, { teamId }, apiKey);

		const projects = data.team.projects.nodes;
		return includeCompleted
			? projects
			: projects.filter(
					(p) => p.state !== "completed" && p.state !== "canceled",
				);
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

		const data = await executeQuery<{ projects: { nodes: Project[] } }>(
			query,
			{ filter },
			apiKey,
		);

		return data.projects.nodes;
	}
}

/**
 * Comment type
 */
export interface Comment {
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	user: {
		name: string;
	};
}

/**
 * Get comments for an issue
 */
export async function getIssueComments(
	apiKey: string,
	identifier: string,
): Promise<Comment[]> {
	const query = `
    query GetIssueComments($id: String!) {
      issue(id: $id) {
        comments {
          nodes {
            id
            body
            createdAt
            updatedAt
            user {
              name
            }
          }
        }
      }
    }
  `;

	const data = await executeQuery<{
		issue: {
			comments: {
				nodes: Array<{
					id: string;
					body: string;
					createdAt: string;
					updatedAt: string;
					user: {
						name: string;
					};
				}>;
			};
		};
	}>(query, { id: identifier }, apiKey);

	return data.issue.comments.nodes.map((comment) => ({
		id: comment.id,
		body: comment.body,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
		user: {
			name: comment.user.name,
		},
	}));
}

/**
 * Create a comment on an issue
 */
export interface CreateCommentInput {
	identifier: string;
	body: string;
}

export interface CreateCommentResult {
	success: boolean;
	comment?: {
		id: string;
	};
}

/**
 * Update a comment
 */
export interface UpdateCommentInput {
	commentId: string;
	body: string;
}

export interface UpdateCommentResult {
	success: boolean;
}

export async function createComment(
	apiKey: string,
	input: CreateCommentInput,
): Promise<CreateCommentResult> {
	// First get the issue ID from identifier
	const issueQuery = `
    query GetIssueId($id: String!) {
      issue(id: $id) {
        id
      }
    }
  `;

	const issueData = await executeQuery<{
		issue: { id: string };
	}>(issueQuery, { id: input.identifier }, apiKey);

	// Create the comment
	const mutation = `
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
        }
      }
    }
  `;

	const data = await executeQuery<{
		commentCreate: {
			success: boolean;
			comment: {
				id: string;
			};
		};
	}>(
		mutation,
		{
			input: {
				issueId: issueData.issue.id,
				body: input.body,
			},
		},
		apiKey,
	);

	return data.commentCreate;
}

/**
 * Update an existing comment
 */
export async function updateComment(
	apiKey: string,
	input: UpdateCommentInput,
): Promise<UpdateCommentResult> {
	const mutation = `
    mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
      }
    }
  `;

	const data = await executeQuery<{
		commentUpdate: {
			success: boolean;
		};
	}>(
		mutation,
		{
			id: input.commentId,
			input: {
				body: input.body,
			},
		},
		apiKey,
	);

	return data.commentUpdate;
}

/**
 * Document type
 */
export interface Document {
	id: string;
	title: string;
	slugId: string;
	url?: string;
	icon?: string | null;
	color?: string | null;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string | null;
	creatorName?: string | null;
	projectName?: string | null;
	initiativeName?: string | null;
	content?: string | null;
}

/**
 * Get workspace overview - all teams, users, labels, states, projects, and active issues
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
	activeIssues: Issue[];
}

/**
 * List documents with minimal payload (only title and slugId)
 */
export async function listDocuments(
	apiKey: string,
	query?: string,
	filter?: {
		projectId?: string;
		initiativeId?: string;
		includeArchived?: boolean;
	},
	first = 25,
): Promise<Pick<Document, "title" | "slugId">[]> {
	const filterObj: Record<string, unknown> = {};
	if (filter?.projectId) filterObj.project = { id: { eq: filter.projectId } };
	if (filter?.initiativeId)
		filterObj.initiative = { id: { eq: filter.initiativeId } };
	// Note: DocumentFilter doesn't support archivedAt filtering
	// We'll filter archived documents in post-processing if needed

	// Add text search to filter if query provided
	// Note: DocumentFilter only supports title search, not content
	if (query) {
		filterObj.title = { containsIgnoreCase: query };
	}

	const graphqlQuery = `
    query ListDocuments($filter: DocumentFilter, $first: Int) {
      documents(filter: $filter, first: $first) {
        nodes {
          title
          slugId
          archivedAt
        }
      }
    }
  `;

	const data = await executeQuery<{
		documents: {
			nodes: Array<{
				title: string;
				slugId: string;
				archivedAt: string | null;
			}>;
		};
	}>(graphqlQuery, { filter: filterObj, first }, apiKey);

	// Filter out archived documents if includeArchived is false, then map to minimal fields
	return data.documents.nodes
		.filter((doc) => filter?.includeArchived || !doc.archivedAt)
		.map(({ title, slugId }) => ({ title, slugId }));
}

/**
 * Get full document details with content by slugId
 */
export async function getDocument(
	apiKey: string,
	slugId: string,
): Promise<Document> {
	// First, query documents to find the one with matching slugId
	const query = `
    query GetDocumentBySlugId($filter: DocumentFilter) {
      documents(filter: $filter, first: 1) {
        nodes {
          id
          title
          slugId
          url
          icon
          color
          content
          createdAt
          updatedAt
          archivedAt
          creator { name }
          project { name }
          initiative { name }
        }
      }
    }
  `;

	const data = await executeQuery<{
		documents: {
			nodes: Array<{
				id: string;
				title: string;
				slugId: string;
				url: string | null;
				icon: string | null;
				color: string | null;
				content: string | null;
				createdAt: string;
				updatedAt: string;
				archivedAt: string | null;
				creator: { name: string } | null;
				project: { name: string } | null;
				initiative: { name: string } | null;
			}>;
		};
	}>(query, { filter: { slugId: { eq: slugId } } }, apiKey);

	if (data.documents.nodes.length === 0) {
		throw new Error(`Document not found with slugId: ${slugId}`);
	}

	const doc = data.documents.nodes[0];
	return {
		id: doc.id,
		title: doc.title,
		slugId: doc.slugId,
		url: doc.url || undefined,
		icon: doc.icon,
		color: doc.color,
		content: doc.content,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
		archivedAt: doc.archivedAt,
		creatorName: doc.creator?.name || null,
		projectName: doc.project?.name || null,
		initiativeName: doc.initiative?.name || null,
	};
}

/**
 * Create a new document
 */
export interface CreateDocumentInput {
	title: string;
	content?: string;
	projectId?: string;
	initiativeId?: string;
}

export interface CreateDocumentResult {
	success: boolean;
	document?: {
		id: string;
		title: string;
		slugId: string;
		url: string;
	};
}

export async function createDocument(
	apiKey: string,
	input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
	const mutation = `
    mutation CreateDocument($input: DocumentCreateInput!) {
      documentCreate(input: $input) {
        success
        document {
          id
          title
          slugId
          url
        }
      }
    }
  `;

	const data = await executeQuery<{
		documentCreate: {
			success: boolean;
			document: {
				id: string;
				title: string;
				slugId: string;
				url: string;
			};
		};
	}>(mutation, { input }, apiKey);

	return data.documentCreate;
}

/**
 * Update an existing document
 */
export interface UpdateDocumentInput {
	id: string;
	title?: string;
	content?: string;
	projectId?: string;
	initiativeId?: string;
}

export interface UpdateDocumentResult {
	success: boolean;
}

export async function updateDocument(
	apiKey: string,
	input: UpdateDocumentInput,
): Promise<UpdateDocumentResult> {
	const mutation = `
    mutation UpdateDocument($id: String!, $input: DocumentUpdateInput!) {
      documentUpdate(id: $id, input: $input) {
        success
      }
    }
  `;

	const { id, ...updateInput } = input;

	const data = await executeQuery<{
		documentUpdate: {
			success: boolean;
		};
	}>(mutation, { id, input: updateInput }, apiKey);

	return data.documentUpdate;
}

/**
 * Create a document by name (user-friendly API)
 */
export interface CreateDocumentByNameInput {
	title: string;
	projectName: string;
	content?: string;
}

export async function createDocumentByName(
	apiKey: string,
	input: CreateDocumentByNameInput,
): Promise<CreateDocumentResult> {
	// Resolve projectName to projectId
	const projects = await listProjects(apiKey);
	const project = projects.find((p) => p.name === input.projectName);
	if (!project) {
		throw new Error(`Project not found: ${input.projectName}`);
	}

	return createDocument(apiKey, {
		title: input.title,
		content: input.content,
		projectId: project.id,
	});
}

/**
 * Update a document by slugId (user-friendly API)
 */
export interface UpdateDocumentByNameInput {
	slugId: string;
	title?: string;
	content?: string;
	projectName?: string;
	initiativeName?: string;
}

export async function updateDocumentByName(
	apiKey: string,
	input: UpdateDocumentByNameInput,
): Promise<UpdateDocumentResult> {
	// First, find the document by slugId to get its internal ID
	const document = await getDocument(apiKey, input.slugId);

	// Resolve projectName to projectId if provided
	let projectId: string | undefined;
	if (input.projectName) {
		const projects = await listProjects(apiKey);
		const project = projects.find((p) => p.name === input.projectName);
		if (!project) {
			throw new Error(`Project not found: ${input.projectName}`);
		}
		projectId = project.id;
	}

	// Resolve initiativeName to initiativeId if provided
	let initiativeId: string | undefined;
	if (input.initiativeName) {
		const initiatives = await listInitiatives(apiKey);
		const initiative = initiatives.find((i) => i.name === input.initiativeName);
		if (!initiative) {
			throw new Error(`Initiative not found: ${input.initiativeName}`);
		}
		initiativeId = initiative.id;
	}

	return updateDocument(apiKey, {
		id: document.id,
		title: input.title,
		content: input.content,
		projectId,
		initiativeId,
	});
}

export async function getWorkspaceOverview(
	apiKey: string,
): Promise<WorkspaceOverview> {
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
          labels {
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
				labels: { nodes: Array<{ name: string }> };
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

	// Get active issues using the existing listIssues function
	const activeIssuesRaw = await listIssues(
		apiKey,
		undefined,
		{
			includeCompleted: false,
			includeBacklog: false,
		},
		50,
	);

	// Map teams with labels directly from the query result (no N+1)
	const teamsWithLabels = data.teams.nodes.map((team) => ({
		id: team.id,
		name: team.name,
		key: team.key,
		states: team.states.nodes.map((s) => s.name),
		labels: team.labels.nodes.map((l) => l.name),
		projects: team.projects.nodes
			.filter((p) => p.state !== "completed" && p.state !== "canceled")
			.map((p) => p.name),
	}));

	return {
		teams: teamsWithLabels,
		workspaceLabels: data.issueLabels.nodes.map((l) => l.name),
		initiatives: data.initiatives.nodes.map((i) => i.name),
		users: data.users.nodes,
		activeIssues: activeIssuesRaw,
	};
}
