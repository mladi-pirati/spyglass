import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const helmInternalPromise = import("@/lib/helm-internal");

describe("audit role authorization", () => {
  test("uses the smallest Helm priority", async () => {
    const { canViewAudit } = await helmInternalPromise;
    const originalFetch = globalThis.fetch;
    const oldUrl = process.env.HELM_API_URL;
    const oldSecret = process.env.SPYGLASS_HELM_SHARED_SECRET;
    process.env.HELM_API_URL = "https://helm.test";
    process.env.SPYGLASS_HELM_SHARED_SECRET = "secret";
    globalThis.fetch = (() => Promise.resolve(Response.json({ roles: [
      { key: "member", name: "Member", priority: 3 },
      { key: "super-admin", name: "Super Admin", priority: 1 },
    ] }))) as unknown as typeof fetch;
    try {
      expect(await canViewAudit([{ key: "super-admin" }])).toBe(true);
      expect(await canViewAudit([{ key: "member" }])).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HELM_API_URL = oldUrl;
      process.env.SPYGLASS_HELM_SHARED_SECRET = oldSecret;
    }
  });
});
