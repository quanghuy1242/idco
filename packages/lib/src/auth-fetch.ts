import { AuthApiError } from "./shared/errors";
export { AuthApiError } from "./shared/errors";

/**
 * Internal: serialises a flat params record into a URL query string.
 * undefined / "" values are omitted.
 */
function buildQuery(
  params?: Record<string, string | number | undefined>,
): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Internal: performs a GET request against a Better Auth endpoint.
 *
 * The caller receives the raw {@link Response} so the two public GET
 * variants can decide whether to throw or swallow HTTP errors.
 *
 * @param path    — path relative to `/api/auth` (e.g. `"/admin/list-users"`)
 * @param params  — optional flat key/value map serialised as query string
 * @param init    — optional `RequestInit` overrides (headers are merged)
 */
async function apiGetFetch(
  path: string,
  params?: Record<string, string | number | undefined>,
  init?: RequestInit,
): Promise<Response> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  return fetch(`/api/auth${path}${buildQuery(params)}`, {
    ...restInit,
    headers: { accept: "application/json", ...initHeaders },
  });
}

/**
 * Internal: performs a POST request against a Better Auth endpoint.
 *
 * The caller receives the raw {@link Response} so the two public POST
 * variants can decide whether to throw or swallow HTTP errors.
 *
 * @param path  — path relative to `/api/auth` (e.g. `"/admin/create-user"`)
 * @param body  — optional JSON-serialisable request body
 * @param init  — optional `RequestInit` overrides (headers are merged)
 */
async function apiPostFetch(
  path: string,
  body: unknown | undefined,
  init: RequestInit | undefined,
): Promise<Response> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  return fetch(`/api/auth${path}`, {
    ...restInit,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...initHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Internal: performs an OAuth-style form POST against a Better Auth endpoint.
 *
 * Use this for protocol endpoints such as token introspection where the wire
 * format is `application/x-www-form-urlencoded`, not JSON.
 */
async function apiFormPostFetch(
  path: string,
  body: URLSearchParams,
  init: RequestInit | undefined,
): Promise<Response> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  return fetch(`/api/auth${path}`, {
    ...restInit,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...initHeaders,
    },
    body,
  });
}

/**
 * Internal: performs a request with an arbitrary JSON body method (PATCH/DELETE).
 *
 * Only the OAuth2 client-management and OAuth plugin admin endpoints
 * (`/admin/resource-servers/*`, `/admin/oauth-scopes/*`,
 * `/admin/oauth-client-resource-scopes/*`) use REST verbs; Better Auth's
 * admin/organization endpoints are POST-only (see {@link authApiPostOrThrow}).
 *
 * @param method — `"PATCH"` or `"DELETE"`
 * @param path   — path relative to `/api/auth` (e.g. `"/admin/resource-servers/abc"`)
 * @param body   — optional JSON-serialisable request body
 * @param init   — optional `RequestInit` overrides (headers are merged)
 */
async function apiBodyFetch(
  method: "PATCH" | "DELETE",
  path: string,
  body: unknown | undefined,
  init: RequestInit | undefined,
): Promise<Response> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  return fetch(`/api/auth${path}`, {
    ...restInit,
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...initHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parseJsonOrUndefined<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

type ApiErrorDetails = {
  readonly message: string;
  readonly code?: string;
};

/** Error-body fields that must never be displayed verbatim in admin alerts. */
const SENSITIVE_FIELD =
  "(?:client_secret|clientSecret|access_token|accessToken|refresh_token|refreshToken|id_token|idToken|session_token|sessionToken|password|newPassword|private_key|privateKey|api_key|apiKey|authorization|secret)";
const SENSITIVE_JSON_FIELD_PATTERN = new RegExp(
  `("${SENSITIVE_FIELD}"\\s*:\\s*)"[^"]*"`,
  "gi",
);
const SENSITIVE_QUERY_FIELD_PATTERN = new RegExp(
  `\\b(${SENSITIVE_FIELD})=([^\\s&]+)`,
  "gi",
);
const AUTHORIZATION_HEADER_PATTERN =
  /\b(authorization:\s*)(?:bearer|basic)\s+[\w.+/~=-]+/gi;
const AUTHORIZATION_VALUE_PATTERN = /\b(Bearer|Basic)\s+[\w.+/~=-]+/g;
const OPENAI_SECRET_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
const STRUCTURED_ERROR_TEXT_PATTERN = /^(?:\{|\[)|<html|<!doctype/i;
/** Maximum validation issue messages to display before summarising the rest. */
const MAX_VALIDATION_ISSUES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(SENSITIVE_JSON_FIELD_PATTERN, '$1"[redacted]"')
    .replace(SENSITIVE_QUERY_FIELD_PATTERN, "$1=[redacted]")
    .replace(AUTHORIZATION_HEADER_PATTERN, "$1[redacted]")
    .replace(AUTHORIZATION_VALUE_PATTERN, "$1 [redacted]")
    .replace(OPENAI_SECRET_KEY_PATTERN, "[redacted]")
    .replace(JWT_PATTERN, "[redacted]")
    .replace(PRIVATE_KEY_PATTERN, "[redacted]");
}

function validationIssuePath(path: unknown): string | undefined {
  if (typeof path === "string" && path.trim()) return path.trim();
  if (!Array.isArray(path) || path.length === 0) return undefined;
  const segments = path
    .map((segment) =>
      typeof segment === "string" || typeof segment === "number"
        ? String(segment)
        : "",
    )
    .filter(Boolean);
  return segments.length > 0 ? segments.join(".") : undefined;
}

function validationIssueMessage(issue: unknown): string | undefined {
  if (typeof issue === "string" && issue.trim())
    return sanitizeErrorMessage(issue.trim());
  if (!isRecord(issue)) return undefined;
  const message =
    readString(issue, "message") ??
    readString(issue, "description") ??
    readString(issue, "code");
  if (!message) return undefined;
  const path = validationIssuePath(issue.path);
  return sanitizeErrorMessage(path ? `${path}: ${message}` : message);
}

function validationIssuesMessage(issues: unknown): string | undefined {
  if (!Array.isArray(issues)) return undefined;
  const messages = issues
    .map(validationIssueMessage)
    .filter((message): message is string => Boolean(message))
    .slice(0, MAX_VALIDATION_ISSUES);
  if (messages.length === 0) return undefined;
  const remaining = issues.length - messages.length;
  return remaining > 0
    ? `${messages.join("; ")}; ${remaining} more issue${remaining === 1 ? "" : "s"}`
    : messages.join("; ");
}

function fallbackErrorMessage(res: Response): string {
  return res.statusText
    ? `Request failed (${res.status} ${res.statusText})`
    : `Request failed (${res.status})`;
}

function safeTextMessage(text: string, res: Response): string {
  const trimmed = text.trim();
  if (!trimmed) return fallbackErrorMessage(res);
  if (STRUCTURED_ERROR_TEXT_PATTERN.test(trimmed))
    return fallbackErrorMessage(res);
  return sanitizeErrorMessage(trimmed);
}

function errorDetailsFromRecord(
  record: Record<string, unknown>,
  res: Response,
): ApiErrorDetails {
  const issueMessage =
    validationIssuesMessage(record.issues) ??
    validationIssuesMessage(record.errors);
  const primary =
    readString(record, "error_description") ??
    readString(record, "message") ??
    issueMessage ??
    readString(record, "error") ??
    readString(record, "code");
  const message =
    primary && issueMessage && primary !== issueMessage
      ? `${primary}: ${issueMessage}`
      : primary;
  const code = readString(record, "code") ?? readString(record, "error");
  return {
    message: sanitizeErrorMessage(message ?? fallbackErrorMessage(res)),
    code,
  };
}

function normalizeAuthApiError(
  bodyText: string,
  res: Response,
): ApiErrorDetails {
  if (bodyText.trim()) {
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      if (isRecord(parsed)) return errorDetailsFromRecord(parsed, res);
      if (typeof parsed === "string")
        return { message: safeTextMessage(parsed, res) };
      const issueMessage = validationIssuesMessage(parsed);
      if (issueMessage) return { message: issueMessage };
    } catch {
      return { message: safeTextMessage(bodyText, res) };
    }
  }
  return { message: fallbackErrorMessage(res) };
}

async function throwApiError(res: Response): Promise<never> {
  const details = normalizeAuthApiError(await res.text(), res);
  throw new AuthApiError(details.message, {
    status: res.status,
    code: details.code,
  });
}

// ─── Public GET helpers ───────────────────────────────────────────

/**
 * GET a Better Auth endpoint and return JSON without throwing on HTTP errors.
 *
 * Use for login / consent / OAuth flows where a non-2xx response carries
 * flow-specific payloads the caller inspects (e.g. `admin_otp_required`,
 * `message`, `redirect_uri`).
 *
 * JSON parse failures are swallowed; the caller receives `{}`.
 *
 * @param path    — path relative to `/api/auth` (e.g. `"/get-session"`)
 * @param params  — optional flat key/value map serialised as query string
 * @param init    — optional `RequestInit` overrides (e.g. `credentials: "include"`)
 */
export async function authApiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  init?: RequestInit,
): Promise<T> {
  const res = await apiGetFetch(path, params, init);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * GET a Better Auth endpoint and throw a normalized {@link AuthApiError} on !ok.
 *
 * Use for admin / organisation data-fetching where every non-2xx is a
 * hard error that the caller should not need to inspect.
 *
 * @param path    — path relative to `/api/auth` (e.g. `"/admin/list-users"`)
 * @param params  — optional flat key/value map serialised as query string
 * @param init    — optional `RequestInit` overrides
 */
export async function authApiGetOrThrow<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  init?: RequestInit,
): Promise<T> {
  const res = await apiGetFetch(path, params, init);
  if (!res.ok) await throwApiError(res);
  return parseJsonOrUndefined<T>(res);
}

// ─── Public POST helpers ──────────────────────────────────────────

/**
 * POST a Better Auth endpoint and return JSON without throwing on HTTP errors.
 *
 * Use for login / consent / OAuth flows where a non-2xx response carries
 * flow-specific payloads the caller inspects (e.g. `admin_otp_required`,
 * `message`, `redirect_uri`).
 *
 * JSON parse failures are swallowed; the caller receives `{}`.
 *
 * @param path  — path relative to `/api/auth` (e.g. `"/sign-in/email"`)
 * @param body  — optional JSON-serialisable request body
 * @param init  — optional `RequestInit` overrides (e.g. `{ headers: { "x-id-oauth-context": "..." } }`)
 */
export async function authApiPost<T>(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await apiPostFetch(path, body, init);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * POST a Better Auth endpoint and throw a normalized {@link AuthApiError} on !ok.
 *
 * Use for **all admin UI mutations** (create, update, delete, set-role,
 * ban, revoke, impersonate, etc.).  Better Auth uses `POST` for every
 * write — the path segment (e.g. `"/admin/remove-user"`,
 * `"/organization/delete"`) carries the semantics, not the HTTP method.
 * Do not attempt to use `PATCH`, `PUT`, or `DELETE` for admin /
 * organisation endpoints — those methods belong exclusively to the
 * OAuth2 client-management plugin.
 *
 * @param path  — path relative to `/api/auth` (e.g. `"/admin/remove-user"`)
 * @param body  — optional JSON-serialisable request body
 * @param init  — optional `RequestInit` overrides
 */
export async function authApiPostOrThrow<T>(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await apiPostFetch(path, body, init);
  if (!res.ok) await throwApiError(res);
  return parseJsonOrUndefined<T>(res);
}

/**
 * POST a Better Auth endpoint with an `application/x-www-form-urlencoded` body
 * and throw a normalized {@link AuthApiError} on !ok.
 *
 * Use for standards-defined OAuth endpoints that require form encoding and may
 * authenticate the client with headers. Do not use this for admin CRUD JSON
 * mutations; use {@link authApiPostOrThrow} there.
 *
 * @param path  — path relative to `/api/auth` (e.g. `"/oauth2/introspect"`)
 * @param body  — URLSearchParams carrying the form body
 * @param init  — optional `RequestInit` overrides
 */
export async function authApiFormPostOrThrow<T>(
  path: string,
  body: URLSearchParams,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFormPostFetch(path, body, init);
  if (!res.ok) await throwApiError(res);
  return parseJsonOrUndefined<T>(res);
}

// ─── Public PATCH / DELETE helpers (OAuth plugin endpoints only) ───

/**
 * PATCH a Better Auth OAuth-plugin endpoint and throw a normalized {@link AuthApiError} on !ok.
 *
 * Use only for the resource-server / scope-catalog plugin update endpoints,
 * which take flat (non-`data:`-wrapped) bodies and respond with the updated
 * entity. Do NOT use for admin/organization endpoints — those are POST-only
 * (see {@link authApiPostOrThrow}).
 *
 * @param path  — path relative to `/api/auth` (e.g. `"/admin/resource-servers/abc"`)
 * @param body  — flat JSON-serialisable request body
 * @param init  — optional `RequestInit` overrides
 */
export async function authApiPatchOrThrow<T>(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await apiBodyFetch("PATCH", path, body, init);
  if (!res.ok) await throwApiError(res);
  return parseJsonOrUndefined<T>(res);
}

/**
 * DELETE a Better Auth OAuth-plugin endpoint and throw a normalized {@link AuthApiError} on !ok.
 *
 * Use only for the resource-server / M2M-binding plugin delete endpoints.
 * Do NOT use for admin/organization endpoints — those are POST-only
 * (see {@link authApiPostOrThrow}).
 *
 * @param path  — path relative to `/api/auth` (e.g. `"/admin/resource-servers/abc"`)
 * @param init  — optional `RequestInit` overrides
 */
export async function authApiDeleteOrThrow<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiBodyFetch("DELETE", path, undefined, init);
  if (!res.ok) await throwApiError(res);
  return parseJsonOrUndefined<T>(res);
}
