/**
 * Error type thrown by the auth-fetch helpers.
 *
 * @module
 * @categoryDefault Auth Fetch
 */

/**
 * Error thrown when a Better Auth request fails, carrying the HTTP status and optional machine-readable error code alongside a redacted, display-safe message.
 *
 * @category Auth Fetch
 */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(
    message: string,
    options: { readonly status: number; readonly code?: string },
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = options.status;
    this.code = options.code;
  }
}
