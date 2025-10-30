/**
 * Lightweight Linear GraphQL client - Core client and utilities
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";

/**
 * Execute a GraphQL query against Linear API
 */
export async function executeQuery<T>(
	query: string,
	variables: Record<string, unknown>,
	apiKey: string,
): Promise<T> {
	if (!apiKey) {
		throw new Error("API key is required but was not provided");
	}

	// Linear API keys (lin_api_*) don't use Bearer prefix
	// OAuth tokens need Bearer prefix
	const authorizationHeader = apiKey.startsWith("lin_api_")
		? apiKey
		: apiKey.startsWith("Bearer ")
			? apiKey
			: `Bearer ${apiKey}`;

	const response = await fetch(LINEAR_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: authorizationHeader,
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		const errorText = await response.text();

		// Handle rate limiting with Retry-After header
		if (response.status === 429) {
			const retryAfter = response.headers.get("Retry-After");
			const waitTime = retryAfter ? `${retryAfter} seconds` : "a while";
			throw new Error(
				`Linear API rate limit exceeded. Please retry after ${waitTime}.`,
			);
		}

		throw new Error(
			`Linear API error: ${response.status} ${response.statusText}\nResponse: ${errorText}`,
		);
	}

	const json = (await response.json()) as { data: T; errors?: unknown[] };

	if (json.errors) {
		throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
	}

	return json.data;
}
