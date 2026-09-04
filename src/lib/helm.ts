import { createClient } from "@mp/helm-sdk";

import { auth } from "@/auth";

function createHelmClient(
  getToken: () => string | null | Promise<string | null>,
) {
  return createClient({
    baseUrl: process.env.HELM_API_URL!,
    getToken,
  });
}

export async function getHelm(token?: string) {
  if (token) return createHelmClient(() => token);

  const session = await auth();
  return createHelmClient(() => session?.accessToken ?? null);
}
