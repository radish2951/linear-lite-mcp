/**
 * Project-related functions for Linear API
 */

import { executeQuery } from "./client.js";

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
}

/**
 * Project type
 */
export interface Project {
	id: string;
	name: string;
	state: string;
}

/**
 * List projects for a team or workspace
 */
export async function listProjects(
	apiKey: string,
	teamId?: string,
	includeCompleted = false,
	options?: QueryOptions,
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
		}>(query, { teamId }, apiKey, options);

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
			options,
		);

		return data.projects.nodes;
	}
}
