/**
 * Label-related functions for Linear API
 */

import { executeQuery } from "./client.js";

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
}

/**
 * Label type
 */
export interface Label {
	id: string;
	name: string;
	color: string;
}

/**
 * List labels for a team or workspace
 */
export async function listLabels(
	apiKey: string,
	teamId?: string,
	options?: QueryOptions,
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
		options,
	);

	return data.issueLabels.nodes;
}
