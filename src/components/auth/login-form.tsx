import { loginAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";

interface LoginFormProps {
  errorMessage?: string;
}

export function LoginForm({ errorMessage }: LoginFormProps) {
  return (
    <form action={loginAction} className="grid gap-4">
      {errorMessage && (
        <p className="text-destructive text-sm font-medium">{errorMessage}</p>
      )}
      <Button type="submit" className="w-full">
        Sign in with Keycloak
      </Button>
    </form>
  );
}
