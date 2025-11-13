/**
 * Team and State-related functions for Linear API
 */

import { executeQuery } from "./client.js";

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
}

/**
 * Team type
 */
export interface Team {
	id: string;
	name: string;
	key: string;
}

/**
 * List teams
 */
export async function listTeams(apiKey: string, options?: QueryOptions): Promise<Team[]> {
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
		options,
	);

	return data.teams.nodes;
}

/**
 * Workflow state type
 */
export interface State {
	id: string;
	name: string;
	type: string;
}

/**
 * List workflow states for a team
 */
export async function listStates(
	apiKey: string,
	teamId: string,
	options?: QueryOptions,
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
		options,
	);

	return data.team.states.nodes;
}
