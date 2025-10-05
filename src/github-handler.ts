import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { Octokit } from "octokit";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import {
	clientIdAlreadyApproved,
	createSignedState,
	generateNonce,
	parseRedirectApproval,
	parseSignedState,
	renderApprovalDialog,
} from "./workers-oauth-utils";

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
		await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)
	) {
		try {
			return await redirectToGithub(c.req.raw, oauthReqInfo, c.env);
		} catch (error) {
			console.error("Failed to initiate GitHub OAuth redirect:", error);
			return c.text("Unable to initiate authorization", 400);
		}
	}

	const approvalState = await createSignedState({ oauthReqInfo }, c.env.COOKIE_ENCRYPTION_KEY);

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			description: "Linear Lite MCP Server with GitHub OAuth authentication",
			logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
			name: "Linear Lite MCP Server",
		},
		state: approvalState,
	});
});

app.post("/authorize", async (c) => {
	const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
	if (!state.oauthReqInfo) {
		return c.text("Invalid request", 400);
	}

	try {
		return await redirectToGithub(c.req.raw, state.oauthReqInfo, c.env, headers);
	} catch (error) {
		console.error("Failed to initiate GitHub OAuth redirect:", error);
		return c.text("Unable to initiate authorization", 400);
	}
});

async function redirectToGithub(
	request: Request,
	oauthReqInfo: AuthRequest,
	env: Env,
	headers: Record<string, string> = {},
): Promise<Response> {
	const nonce = generateNonce();
	const signedState = await createSignedState({ oauthReqInfo, nonce }, env.COOKIE_ENCRYPTION_KEY);
	const callbackUrl = resolveCallbackUrl(request, env);
	const responseHeaders = new Headers(headers);

	responseHeaders.set(
		"location",
		getUpstreamAuthorizeUrl({
			client_id: env.GITHUB_CLIENT_ID,
			redirect_uri: callbackUrl,
			scope: "read:user",
			state: signedState,
			upstream_url: "https://github.com/login/oauth/authorize",
		}),
	);

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

	const nonceCookie = getCookie(c.req.raw.headers.get("Cookie"), OAUTH_STATE_COOKIE);
	if (!nonceCookie || nonceCookie !== parsedState.nonce) {
		return buildErrorResponse("State verification failed", 400, true);
	}

	let callbackUrl: string;
	try {
		callbackUrl = resolveCallbackUrl(c.req.raw, c.env);
	} catch (error) {
		console.error("Invalid callback host detected:", error);
		return buildErrorResponse("Invalid callback host", 400, true);
	}

	const [accessToken, errResponse] = await fetchUpstreamAuthToken({
		client_id: c.env.GITHUB_CLIENT_ID,
		client_secret: c.env.GITHUB_CLIENT_SECRET,
		code: c.req.query("code"),
		redirect_uri: callbackUrl,
		upstream_url: "https://github.com/login/oauth/access_token",
	});
	if (errResponse) {
		const body = await errResponse.text();
		const headers = new Headers(errResponse.headers);
		if (!headers.has("content-type")) {
			headers.set("content-type", "text/plain; charset=utf-8");
		}
		clearOAuthStateCookie(headers);
		return new Response(body, { status: errResponse.status, headers });
	}

	const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
	const { login, name, email } = user.data;

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: name,
		},
		props: {
			accessToken,
			email,
			login,
			name,
		} as Props,
		request: parsedState.oauthReqInfo,
		scope: parsedState.oauthReqInfo.scope,
		userId: login,
	});

	const headers = new Headers();
	clearOAuthStateCookie(headers);
	headers.set("location", redirectTo);

	return new Response(null, { status: 302, headers });
});

export { app as GitHubHandler };

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

function buildErrorResponse(message: string, status: number, clearState = false): Response {
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

function resolveCallbackUrl(request: Request, env: Env): string {
	const envRecord = env as unknown as Record<string, string | undefined>;
	const configuredBase = envRecord.PUBLIC_BASE_URL;
	if (configuredBase) {
		const baseUrl = new URL(configuredBase);
		return new URL("/callback", baseUrl).href;
	}

	const allowedHostsRaw = envRecord.ALLOWED_CALLBACK_HOSTS;
	const allowedHosts = allowedHostsRaw
		? allowedHostsRaw.split(",").map((host) => host.trim()).filter(Boolean)
		: [];
	const incomingUrl = new URL(request.url);
	if (allowedHosts.length > 0 && !allowedHosts.includes(incomingUrl.host)) {
		throw new Error(`Host ${incomingUrl.host} is not allowed for OAuth callbacks.`);
	}

	incomingUrl.hash = "";
	incomingUrl.search = "";
	incomingUrl.pathname = "/callback";
	incomingUrl.username = "";
	incomingUrl.password = "";

	return incomingUrl.href;
}
