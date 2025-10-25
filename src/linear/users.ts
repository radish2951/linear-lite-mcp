/**
 * User-related functions for Linear API
 */

import { executeQuery } from "./client.js";

/**
 * User type
 */
export interface User {
	id: string;
	name: string;
	active: boolean;
}

/**
 * List users
 */
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
