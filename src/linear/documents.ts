/**
 * Document-related functions for Linear API
 */

import { executeQuery } from "./client.js";
import { listProjects } from "./projects.js";
import { listInitiatives } from "./initiatives.js";

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
 * Create document input
 */
export interface CreateDocumentInput {
	title: string;
	content?: string;
	projectId?: string;
	initiativeId?: string;
}

/**
 * Create document result
 */
export interface CreateDocumentResult {
	success: boolean;
	document?: {
		id: string;
		title: string;
		slugId: string;
		url: string;
	};
}

/**
 * Create a new document
 */
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
 * Update document input
 */
export interface UpdateDocumentInput {
	id: string;
	title?: string;
	content?: string;
	projectId?: string;
	initiativeId?: string;
}

/**
 * Update document result
 */
export interface UpdateDocumentResult {
	success: boolean;
}

/**
 * Update an existing document
 */
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
 * Create document by name input
 */
export interface CreateDocumentByNameInput {
	title: string;
	projectName: string;
	content?: string;
}

/**
 * Create a document by name (user-friendly API)
 */
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
 * Update document by name input
 */
export interface UpdateDocumentByNameInput {
	slugId: string;
	title?: string;
	content?: string;
	projectName?: string;
	initiativeName?: string;
}

/**
 * Update a document by slugId (user-friendly API)
 */
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
