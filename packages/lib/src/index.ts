export * from "./constants";
export * from "./auth-fetch";
export * from "./cn";
export * from "./console-scope";
export * from "./rich-text";

/** Core worker health endpoint path. */
export const CORE_HEALTH_PATH = "/health";

export type HealthResponse = {
  readonly ok: boolean;
  readonly service: string;
};
