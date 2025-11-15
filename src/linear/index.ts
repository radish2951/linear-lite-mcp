/**
 * Linear API client - main export file
 */

// Core client
export { executeQuery } from "./client.js";

// Issues
export {
	listIssues,
	getIssue,
	createIssue,
	updateIssue,
	createIssueByName,
	updateIssueByName,
} from "./issues.js";
export type {
	Issue,
	CreateIssueInput,
	CreateIssueResult,
	UpdateIssueInput,
	UpdateIssueResult,
	CreateIssueByNameInput,
	UpdateIssueByNameInput,
} from "./issues.js";

// Teams
export { listTeams, listStates } from "./teams.js";
export type { Team, State } from "./teams.js";

// Users
export { listUsers } from "./users.js";
export type { User } from "./users.js";

// Labels
export { listLabels } from "./labels.js";
export type { Label } from "./labels.js";

// Projects
export { listProjects } from "./projects.js";
export type { Project } from "./projects.js";

// Initiatives
export { listInitiatives } from "./initiatives.js";
export type { Initiative } from "./initiatives.js";

// Documents
export {
	listDocuments,
	getDocument,
	createDocument,
	updateDocument,
	createDocumentByName,
	updateDocumentByName,
} from "./documents.js";
export type {
	Document,
	CreateDocumentInput,
	CreateDocumentResult,
	UpdateDocumentInput,
	UpdateDocumentResult,
	CreateDocumentByNameInput,
	UpdateDocumentByNameInput,
} from "./documents.js";

// Workspace
export { getWorkspaceOverview } from "./workspace.js";
export type { WorkspaceOverview } from "./workspace.js";
