/**
 * Workspace-related functions for Linear API
 */

import { executeQuery } from "./client.js";
import { listIssues } from "./issues.js";
import type { Issue } from "./issues.js";

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
}

/**
 * Workspace overview type
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
 * Get workspace overview - all teams, users, labels, states, projects, and active issues
 */
export async function getWorkspaceOverview(
	apiKey: string,
	options?: QueryOptions,
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
	}>(query, {}, apiKey, options);

	// Get active issues using the existing listIssues function
	const activeIssuesRaw = await listIssues(
		apiKey,
		undefined,
		{
			includeCompleted: false,
			includeBacklog: false,
		},
		50,
		options,
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
