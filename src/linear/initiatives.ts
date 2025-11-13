/**
 * Initiative-related functions for Linear API
 */

import { executeQuery } from "./client.js";

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
}

/**
 * Initiative type
 */
export interface Initiative {
	id: string;
	name: string;
}

/**
 * List initiatives
 */
export async function listInitiatives(apiKey: string, options?: QueryOptions): Promise<Initiative[]> {
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
		options,
	);

	return data.initiatives.nodes;
}
