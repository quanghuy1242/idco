/**
 * Public entry barrel for `@quanghuy1242/idco-lib` — framework-free shared helpers and contracts.
 *
 * @module
 * @categoryDefault Constants
 */

export * from "./constants";
export * from "./auth-fetch";
export * from "./cn";
export * from "./console-scope";
export * from "./guards";
export * from "./rich-text";
export * from "./rich-text-style";

/**
 * Path of the core worker health endpoint.
 *
 * @category Constants
 */
export const CORE_HEALTH_PATH = "/health";

/**
 * Response body of the core worker health endpoint: a liveness flag and the reporting service name.
 *
 * @category Constants
 */
export type HealthResponse = {
  readonly ok: boolean;
  readonly service: string;
};
