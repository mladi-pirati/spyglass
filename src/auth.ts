import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { z } from "zod";

import {
  getKeycloakFullNameFromProfile,
  getKeycloakUsernameFromProfile,
} from "@/lib/auth/keycloak-access";
import { getHelm } from "@/lib/helm";

const keycloakProfileSchema = z
  .object({ sub: z.string().min(1) })
  .passthrough();

const refreshedTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(
    `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.KEYCLOAK_CLIENT_ID!,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
        refresh_token: refreshToken,
      }),
    },
  );

  if (!response.ok) return null;

  const parsed = refreshedTokenSchema.safeParse(await response.json());
  if (!parsed.success) return null;

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    accessTokenExpiresAt:
      Math.floor(Date.now() / 1000) + parsed.data.expires_in,
  };
}

// Auth.js cookies are scoped by host, not port. Namespacing Spyglass cookies
// prevents local sessions from clobbering Helm, Quartermaster, or Logbook.
const useSecureCookies = process.env.NODE_ENV === "production";
const cookiePrefix = "spyglass";
const secureName = (name: string) =>
  `${useSecureCookies ? "__Secure-" : ""}${cookiePrefix}.${name}`;
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: useSecureCookies,
} as const;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: { name: secureName("session-token"), options: cookieOptions },
    callbackUrl: { name: secureName("callback-url"), options: cookieOptions },
    csrfToken: {
      name: `${useSecureCookies ? "__Host-" : ""}${cookiePrefix}.csrf-token`,
      options: cookieOptions,
    },
  },
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      issuer: process.env.KEYCLOAK_ISSUER,
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      if (account?.provider !== "keycloak") return false;

      try {
        const helm = await getHelm(account.access_token);
        const user = await helm.user.me();

        return user.access.applications.some(
          (application: { keycloakClientId: string }) =>
            application.keycloakClientId === process.env.KEYCLOAK_CLIENT_ID,
        );
      } catch (error) {
        console.error("[auth] signIn error:", error);
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "keycloak" && account.access_token) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpiresAt =
          account.expires_at ??
          Math.floor(Date.now() / 1000) + (account.expires_in ?? 300);

        const parsed = keycloakProfileSchema.safeParse(profile);
        if (parsed.success) token.keycloakUserId = parsed.data.sub;

        token.username = getKeycloakUsernameFromProfile(profile) ?? "";
        token.fullName = getKeycloakFullNameFromProfile(profile) ?? "";
        return token;
      }

      if (Date.now() / 1000 < (token.accessTokenExpiresAt ?? 0) - 30) {
        return token;
      }

      if (!token.refreshToken) return null;

      const refreshed = await refreshAccessToken(token.refreshToken);
      if (!refreshed) return null;

      return {
        ...token,
        ...refreshed,
      };
    },
    async session({ session, token }) {
      if (token.accessToken) session.accessToken = token.accessToken;

      if (session.user) {
        session.user.keycloakUserId = token.keycloakUserId ?? "";
        session.user.username = token.username ?? "";
        session.user.fullName = token.fullName ?? "";
      }

      return session;
    },
  },
});
