import { z } from "zod";

export function getKeycloakUsernameFromProfile(profile: unknown) {
  const parsed = z
    .object({
      preferred_username: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
    })
    .passthrough()
    .safeParse(profile);

  if (!parsed.success) return null;

  return (
    parsed.data.preferred_username ??
    parsed.data.email ??
    parsed.data.name ??
    null
  );
}

export function getKeycloakFullNameFromProfile(profile: unknown) {
  const parsed = z
    .object({
      name: z.string().optional(),
      given_name: z.string().optional(),
      family_name: z.string().optional(),
      preferred_username: z.string().optional(),
    })
    .passthrough()
    .safeParse(profile);

  if (!parsed.success) return null;

  const fullName =
    parsed.data.name ??
    [parsed.data.given_name, parsed.data.family_name]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" ");

  return fullName || parsed.data.preferred_username || null;
}
