import "server-only";

import { z } from "zod";

const rolesResponseSchema = z.object({
  roles: z.array(z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    priority: z.number().int().positive(),
  })),
});

export class HelmInternalError extends Error {}

export async function getHelmRolePriorities() {
  const baseUrl = process.env.HELM_API_URL;
  const secret = process.env.SPYGLASS_HELM_SHARED_SECRET;
  if (!baseUrl || !secret) throw new HelmInternalError("Helm internal API is not configured.");

  const response = await fetch(`${baseUrl}/api/internal/spyglass/roles`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new HelmInternalError(`Helm roles request failed (${response.status}).`);

  const parsed = rolesResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.roles.length === 0) {
    throw new HelmInternalError("Helm returned an invalid or empty role list.");
  }
  return parsed.data.roles.toSorted((a, b) => a.priority - b.priority);
}

export async function canViewAudit(userRoles: Array<{ key: string }>) {
  const roles = await getHelmRolePriorities();
  const highest = roles[0];
  return userRoles.some((role) => role.key === highest.key);
}
