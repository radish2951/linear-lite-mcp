import type {
	AuthRequest,
	OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import {
	clientIdAlreadyApproved,
	createSignedState,
	generateNonce,
	parseRedirectApproval,
	parseSignedState,
	renderApprovalDialog,
} from "./utils.js";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

const OAUTH_STATE_COOKIE = "mcp-oauth-state";
const OAUTH_STATE_TTL_SECONDS = 300;

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	if (
		await clientIdAlreadyApproved(
			c.req.raw,
			oauthReqInfo.clientId,
			c.env.COOKIE_ENCRYPTION_KEY,
		)
	) {
		try {
			return await redirectToLinear(c.req.raw, oauthReqInfo, c.env);
		} catch (error) {
			console.error("Failed to initiate Linear OAuth redirect:", error);
			return c.text("Unable to initiate authorization", 400);
		}
	}

	const approvalState = await createSignedState(
		{ oauthReqInfo },
		c.env.COOKIE_ENCRYPTION_KEY,
	);

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			description: "Linear Lite MCP Server - Access your Linear workspace",
			logo: "https://linear.app/favicon.ico",
			name: "Linear Lite MCP Server",
		},
		state: approvalState,
	});
});

app.post("/authorize", async (c) => {
	const { state, headers } = await parseRedirectApproval(
		c.req.raw,
		c.env.COOKIE_ENCRYPTION_KEY,
	);
	if (!state.oauthReqInfo) {
		return c.text("Invalid request", 400);
	}

	try {
		return await redirectToLinear(
			c.req.raw,
			state.oauthReqInfo,
			c.env,
			headers,
		);
	} catch (error) {
		console.error("Failed to initiate Linear OAuth redirect:", error);
		return c.text("Unable to initiate authorization", 400);
	}
});

async function redirectToLinear(
	request: Request,
	oauthReqInfo: AuthRequest,
	env: Env,
	headers: Record<string, string> = {},
): Promise<Response> {
	const nonce = generateNonce();
	const signedState = await createSignedState(
		{ oauthReqInfo, nonce },
		env.COOKIE_ENCRYPTION_KEY,
	);
	const callbackUrl = resolveCallbackUrl(request, env);
	const responseHeaders = new Headers(headers);

	const authorizeUrl = new URL("https://linear.app/oauth/authorize");
	authorizeUrl.searchParams.set("client_id", env.LINEAR_OAUTH_CLIENT_ID);
	authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", "read,write");
	authorizeUrl.searchParams.set("state", signedState);

	responseHeaders.set("location", authorizeUrl.toString());
	appendOAuthStateCookie(responseHeaders, nonce);

	return new Response(null, {
		headers: responseHeaders,
		status: 302,
	});
}

app.get("/callback", async (c) => {
	const stateParam = c.req.query("state");
	if (typeof stateParam !== "string" || !stateParam) {
		return buildErrorResponse("Missing state", 400, true);
	}

	const parsedState = await parseSignedState<{
		oauthReqInfo?: AuthRequest;
		nonce?: string;
	}>(stateParam, c.env.COOKIE_ENCRYPTION_KEY);

	if (!parsedState?.oauthReqInfo?.clientId || !parsedState.nonce) {
		return buildErrorResponse("Invalid state", 400, true);
	}

	const nonceCookie = getCookie(
		c.req.raw.headers.get("Cookie"),
		OAUTH_STATE_COOKIE,
	);
	if (
		!nonceCookie ||
		!parsedState.nonce ||
		!timingSafeEqual(nonceCookie, parsedState.nonce)
	) {
		return buildErrorResponse("State verification failed", 400, true);
	}

	let callbackUrl: string;
	try {
		callbackUrl = resolveCallbackUrl(c.req.raw, c.env);
	} catch (error) {
		console.error("Invalid callback host detected:", error);
		return buildErrorResponse("Invalid callback host", 400, true);
	}

	const code = c.req.query("code");
	if (!code) {
		return buildErrorResponse("Missing authorization code", 400, true);
	}

	// Exchange code for Linear access token
	const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: c.env.LINEAR_OAUTH_CLIENT_ID,
			client_secret: c.env.LINEAR_OAUTH_CLIENT_SECRET,
			redirect_uri: callbackUrl,
			code,
		}),
	});

	if (!tokenResponse.ok) {
		const errorBody = await tokenResponse.text();
		console.error("Linear token exchange failed:", errorBody);
		const headers = new Headers();
		headers.set("content-type", "text/plain; charset=utf-8");
		clearOAuthStateCookie(headers);
		return new Response(`Failed to obtain Linear access token: ${errorBody}`, {
			status: tokenResponse.status,
			headers,
		});
	}

	const tokenData = await tokenResponse.json<{
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
		token_type: string;
	}>();
	const accessToken = tokenData.access_token;
	const refreshToken = tokenData.refresh_token;
	const expiresIn = tokenData.expires_in;

	// Fetch user info from Linear
	const userResponse = await fetch("https://api.linear.app/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
		},
		body: JSON.stringify({
			query: "{ viewer { id name email } }",
		}),
	});

	if (!userResponse.ok) {
		const errorBody = await userResponse.text();
		console.error("Failed to fetch Linear user info:", errorBody);
		return buildErrorResponse(
			"Failed to fetch user information from Linear",
			400,
			true,
		);
	}

	const userData = await userResponse.json<{
		data: { viewer: { id: string; name: string; email: string } };
	}>();

	const { id: userId, name, email } = userData.data.viewer;

	// Calculate token expiration timestamp
	// If Linear doesn't provide expires_in, use 23 hours as conservative default
	const expiresAt = expiresIn
		? Date.now() + expiresIn * 1000
		: Date.now() + 23 * 60 * 60 * 1000;

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: name,
		},
		props: {
			userId,
			name,
			email,
			accessToken,
			refreshToken,
			expiresAt,
		},
		request: parsedState.oauthReqInfo,
		scope: parsedState.oauthReqInfo.scope,
		userId,
	});

	const headers = new Headers();
	clearOAuthStateCookie(headers);
	headers.set("location", redirectTo);

	return new Response(null, { status: 302, headers });
});

export { app as LinearOAuthHandler };

function appendOAuthStateCookie(headers: Headers, nonce: string) {
	headers.append(
		"Set-Cookie",
		`${OAUTH_STATE_COOKIE}=${nonce}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
	);
}

function clearOAuthStateCookie(headers: Headers) {
	headers.append(
		"Set-Cookie",
		`${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`,
	);
}

function buildErrorResponse(
	message: string,
	status: number,
	clearState = false,
): Response {
	const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
	if (clearState) {
		clearOAuthStateCookie(headers);
	}
	return new Response(message, { status, headers });
}

function getCookie(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) {
		return null;
	}

	const cookies = cookieHeader.split(";").map((part) => part.trim());
	const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
	return match ? match.substring(name.length + 1) : null;
}

function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	if (aBytes.length !== bBytes.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < aBytes.length; i += 1) {
		diff |= aBytes[i] ^ bBytes[i];
	}
	return diff === 0;
}

function resolveCallbackUrl(request: Request, env: Env): string {
	const envRecord = env as unknown as Record<string, string | undefined>;
	const configuredBase = envRecord.PUBLIC_BASE_URL;
	if (configuredBase) {
		const baseUrl = new URL(configuredBase);
		return new URL("/callback", baseUrl).href;
	}

	const allowedHostsRaw = envRecord.ALLOWED_CALLBACK_HOSTS;
	const allowedHosts = allowedHostsRaw
		? allowedHostsRaw
				.split(",")
				.map((host) => host.trim())
				.filter(Boolean)
		: [];
	const incomingUrl = new URL(request.url);
	if (allowedHosts.length > 0 && !allowedHosts.includes(incomingUrl.host)) {
		throw new Error(
			`Host ${incomingUrl.host} is not allowed for OAuth callbacks.`,
		);
	}

	incomingUrl.hash = "";
	incomingUrl.search = "";
	incomingUrl.pathname = "/callback";
	incomingUrl.username = "";
	incomingUrl.password = "";

	return incomingUrl.href;
}
