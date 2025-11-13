/**
 * Comment-related functions for Linear API
 */

import { executeQuery } from "./client.js";

/**
 * Options for executeQuery
 */
interface QueryOptions {
	onTokenRefreshNeeded?: () => Promise<string>;
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
	options?: QueryOptions,
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
	}>(query, { id: identifier }, apiKey, options);

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
 * Create comment input
 */
export interface CreateCommentInput {
	identifier: string;
	body: string;
}

/**
 * Create comment result
 */
export interface CreateCommentResult {
	success: boolean;
	comment?: {
		id: string;
	};
}

/**
 * Create a comment on an issue
 */
export async function createComment(
	apiKey: string,
	input: CreateCommentInput,
	options?: QueryOptions,
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
	}>(issueQuery, { id: input.identifier }, apiKey, options);

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
		options,
	);

	return data.commentCreate;
}

/**
 * Update comment input
 */
export interface UpdateCommentInput {
	commentId: string;
	body: string;
}

/**
 * Update comment result
 */
export interface UpdateCommentResult {
	success: boolean;
}

/**
 * Update an existing comment
 */
export async function updateComment(
	apiKey: string,
	input: UpdateCommentInput,
	options?: QueryOptions,
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
		options,
	);

	return data.commentUpdate;
}
