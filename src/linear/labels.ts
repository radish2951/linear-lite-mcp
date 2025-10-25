/**
 * Label-related functions for Linear API
 */

import { executeQuery } from "./client.js";

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
