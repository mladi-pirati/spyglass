import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Spyglass.",
};

function getErrorMessage(error?: string): string | undefined {
  if (!error) return undefined;
  if (error === "AccessDenied") {
    return "Your account is not authorised to access this application.";
  }
  return "Unable to sign in right now. Please try again.";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user) redirect("/");

  const params = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Sign in with your Keycloak account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm errorMessage={getErrorMessage(params.error)} />
        </CardContent>
      </Card>
    </main>
  );
}
