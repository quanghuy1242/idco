/**
 * Console scope, permission, and membership contracts shared between the auth server and console UI.
 *
 * @module
 * @categoryDefault Constants
 */

/** The two kinds of console scope a session can act within: the global platform or a single organization. */
export type ConsoleScopeKind = "platform" | "organization";

/** A fine-grained permission string gating one console action (read/write on platform, organizations, members, OAuth clients, resource servers, audit, JWKS, or system). */
export type ConsolePermission =
  | "platform:read"
  | "platform:write"
  | "organizations:read"
  | "organizations:write"
  | "members:read"
  | "members:write"
  | "oauth-clients:read"
  | "oauth-clients:write"
  | "resource-servers:read"
  | "resource-servers:write"
  | "security-audit:read"
  | "jwks:read"
  | "jwks:rotate"
  | "system:read"
  | "system:write";

/** One scope the actor can enter, carrying its identity, label, role, granted permissions, and whether entry needs a step-up proof. */
export type ConsoleScope = {
  readonly kind: ConsoleScopeKind;
  readonly id: "platform" | `organization:${string}`;
  readonly organizationId?: string;
  readonly label: string;
  readonly role: "platform-admin" | "owner" | "admin";
  readonly permissions: readonly ConsolePermission[];
  readonly requiresStepUp: boolean;
  /**
   * Only set on the platform scope. True when the current session already holds a fresh
   * platform step-up proof, so the console gate can decide entry without a separate
   * step-up status request.
   */
  readonly stepUpSatisfied?: boolean;
};

/** A non-admin organization the actor belongs to, surfaced so the console can hint at memberships that grant no console scope. */
export type ConsoleMembershipHint = {
  readonly organizationId: string;
  readonly label: string;
  readonly role: "member";
};

/** The scope currently selected in the console: either the platform or one organization by id. */
export type ActiveScope =
  | { readonly kind: "platform" }
  | { readonly kind: "organization"; readonly organizationId: string };

/** The full console-entry payload for an actor: who they are, every scope they can enter, their membership hints, and the default scope to open. */
export type ConsoleScopeEnvelope = {
  readonly actor: {
    readonly userId: string;
    readonly email?: string;
    readonly canEnterConsole: boolean;
  };
  readonly scopes: readonly ConsoleScope[];
  readonly memberships: readonly ConsoleMembershipHint[];
  readonly defaultScopeId: ConsoleScope["id"] | null;
};
