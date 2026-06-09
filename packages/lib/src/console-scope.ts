export type ConsoleScopeKind = "platform" | "organization";

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

export type ConsoleMembershipHint = {
  readonly organizationId: string;
  readonly label: string;
  readonly role: "member";
};

export type ActiveScope =
  | { readonly kind: "platform" }
  | { readonly kind: "organization"; readonly organizationId: string };

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
