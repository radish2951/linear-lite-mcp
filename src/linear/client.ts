/**
 * Lightweight Linear GraphQL client - Core client and utilities
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";

/**
 * Error class for authentication failures
 */
export class AuthenticationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthenticationError";
	}
}

/**
 * Error class for rate limit errors
 */
export class RateLimitError extends Error {
	constructor(
		message: string,
		public retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "RateLimitError";
	}
}

/**
 * Execute a GraphQL query against Linear API with automatic retry for 401 and 429 errors
 */
export async function executeQuery<T>(
	query: string,
	variables: Record<string, unknown>,
	apiKey: string,
	options?: {
		onTokenRefreshNeeded?: () => Promise<string>;
		maxRetries?: number;
		maxRetryWaitSeconds?: number;
	},
): Promise<T> {
	const maxRetries = options?.maxRetries ?? 3;
	const maxRetryWaitSeconds = options?.maxRetryWaitSeconds ?? 60;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await executeQueryOnce<T>(query, variables, apiKey);
		} catch (error) {
			lastError = error as Error;

			// Handle 401 - try to refresh token once
			if (error instanceof AuthenticationError && attempt === 0) {
				if (options?.onTokenRefreshNeeded) {
					console.log("Token expired, attempting refresh...");
					apiKey = await options.onTokenRefreshNeeded();
					continue;
				}
			}

			// Handle 429 - retry with exponential backoff
			if (error instanceof RateLimitError) {
				const waitSeconds = Math.min(
					error.retryAfterSeconds ?? Math.pow(2, attempt) * 1,
					maxRetryWaitSeconds,
				);
				console.log(
					`Rate limit hit, waiting ${waitSeconds} seconds before retry...`,
				);
				await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
				continue;
			}

			// For other errors, don't retry
			throw error;
		}
	}

	throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Execute a GraphQL query once (internal helper)
 */
async function executeQueryOnce<T>(
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

		// Handle authentication errors
		if (response.status === 401) {
			throw new AuthenticationError(
				`Authentication failed: ${response.statusText}`,
			);
		}

		// Handle rate limiting with Retry-After header
		if (response.status === 429) {
			const retryAfter = response.headers.get("Retry-After");
			const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : undefined;
			throw new RateLimitError(
				`Linear API rate limit exceeded`,
				retryAfterSeconds,
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
