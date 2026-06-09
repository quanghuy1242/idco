// @vitest-environment jsdom
//
// Imports the helpers from the real source (relative path) rather than the
// `@idco/lib` alias, because other barrel tests `vi.mock("@idco/lib", …)` with a
// partial factory — the alias is globally mocked for the whole run, so a direct
// source import is the only way to exercise the real PATCH/DELETE helpers here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  authApiGetOrThrow,
  authApiPostOrThrow,
  authApiFormPostOrThrow,
  authApiPatchOrThrow,
  authApiDeleteOrThrow,
} from "../../packages/lib/src/auth-fetch";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function lastCall() {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

describe("auth-fetch helpers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET serialises query params and prefixes /api/auth", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await authApiGetOrThrow("/admin/resource-servers", { limit: 25, skip: "" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/admin/resource-servers?limit=25");
    expect(init.headers).toMatchObject({ accept: "application/json" });
  });

  it("POST sends a JSON body with content-type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "x" }));
    await authApiPostOrThrow("/oauth2/create-client", { client_name: "App" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/oauth2/create-client");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ client_name: "App" });
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("form POST sends URLSearchParams with form content-type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ active: true }));
    const body = new URLSearchParams({ token: "tok" });

    await authApiFormPostOrThrow("/oauth2/introspect", body, {
      headers: { authorization: "Basic abc" },
    });

    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/oauth2/introspect");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(init.headers).toMatchObject({
      accept: "application/json",
      authorization: "Basic abc",
      "content-type": "application/x-www-form-urlencoded",
    });
  });

  it("PATCH sends a flat JSON body with the PATCH method", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "rs1" }));
    await authApiPatchOrThrow("/admin/resource-servers/rs1", {
      name: "X",
      description: null,
    });
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/admin/resource-servers/rs1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "X",
      description: null,
    });
  });

  it("DELETE uses the DELETE method and no body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    await authApiDeleteOrThrow("/admin/oauth-client-resource-scopes/b1");
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/admin/oauth-client-resource-scopes/b1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("void endpoints can return an empty success body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      authApiPostOrThrow<void>("/oauth2/delete-client", { client_id: "cli_1" }),
    ).resolves.toBeUndefined();
  });

  it("PATCH throws on a non-2xx response with the body text", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "bad" }, { status: 400 }),
    );
    await expect(
      authApiPatchOrThrow("/admin/oauth-scopes/sc1", { enabled: false }),
    ).rejects.toThrow(/bad/);
  });

  it("DELETE throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "nope" }, { status: 404 }),
    );
    await expect(
      authApiDeleteOrThrow("/admin/resource-servers/rs1"),
    ).rejects.toThrow(/nope/);
  });

  it("normalizes Better Auth JSON errors to a display message with status and code", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: "Resource server slug already exists", code: "BAD_REQUEST" },
        { status: 400 },
      ),
    );

    await expect(
      authApiPostOrThrow("/admin/resource-servers", { slug: "api" }),
    ).rejects.toMatchObject({
      name: "AuthApiError",
      message: "Resource server slug already exists",
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("uses OAuth error_description as the display message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "invalid_scope",
          error_description:
            "scope not enabled for requested resource: content:write",
        },
        { status: 400 },
      ),
    );

    await expect(
      authApiFormPostOrThrow("/oauth2/introspect", new URLSearchParams()),
    ).rejects.toMatchObject({
      message: "scope not enabled for requested resource: content:write",
      code: "invalid_scope",
    });
  });

  it("summarizes validation issues without printing raw JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: "Invalid body",
          issues: [
            { path: ["redirect_uris", 0], message: "Invalid URL" },
            { path: "client_name", message: "Required" },
          ],
        },
        { status: 400 },
      ),
    );

    await expect(
      authApiPostOrThrow("/oauth2/create-client", {}),
    ).rejects.toThrow(
      "Invalid body: redirect_uris.0: Invalid URL; client_name: Required",
    );
  });

  it("redacts sensitive values before exposing an error message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message:
            "client_secret=sk-test-secret12345678 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
          code: "BAD_REQUEST",
        },
        { status: 400 },
      ),
    );

    await expect(
      authApiPostOrThrow("/oauth2/create-client", {}),
    ).rejects.toThrow("client_secret=[redacted] Authorization: [redacted]");
  });

  it("does not print unknown JSON error objects", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ client_secret: "secret-value" }, { status: 500 }),
    );
    const request = authApiGetOrThrow("/admin/list-users");

    await expect(request).rejects.toBeInstanceOf(AuthApiError);
    await expect(request).rejects.toThrow("Request failed");
  });
});
