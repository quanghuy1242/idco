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
