import "server-only";

import { cache } from "react";

import { auth } from "@/auth";
import { getHelm } from "@/lib/helm";

export class SpyglassAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
  }
}

export const requireSpyglassAccess = cache(async () => {
  const session = await auth();
  if (!session?.accessToken) throw new SpyglassAccessError(401, "Authentication required.");

  try {
    const member = await (await getHelm(session.accessToken)).user.me();
    const hasApplication = member.access.applications.some(
      (application) => application.keycloakClientId === process.env.KEYCLOAK_CLIENT_ID,
    );

    if (member.disabled || !hasApplication) {
      throw new SpyglassAccessError(403, "Spyglass access is not assigned.");
    }

    return {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      fullName: `${member.firstName} ${member.lastName}`.trim(),
      username: member.username,
      roles: member.access.roles,
      profilePicture: member.profilePicture,
      accessToken: session.accessToken,
    };
  } catch (error) {
    if (error instanceof SpyglassAccessError) throw error;
    throw new SpyglassAccessError(503, "Helm is currently unavailable.");
  }
});

export function accessErrorResponse(error: unknown) {
  if (error instanceof SpyglassAccessError) {
    return Response.json(
      { error: { code: error.status === 401 ? "unauthenticated" : error.status === 403 ? "forbidden" : "helm_unavailable", message: error.message } },
      { status: error.status },
    );
  }
  return Response.json({ error: { code: "internal_error", message: "Unexpected server error." } }, { status: 500 });
}
