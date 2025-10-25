/**
 * Initiative-related functions for Linear API
 */

import { executeQuery } from "./client.js";

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
