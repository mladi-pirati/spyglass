import Link from "next/link";
import { FileStackIcon, HistoryIcon, SearchIcon, Trash2Icon, UserIcon } from "lucide-react";

import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { requireSpyglassAccess } from "@/lib/auth/access";
import { canViewAudit } from "@/lib/helm-internal";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSpyglassAccess();
  const showAudit = await canViewAudit(user.roles).catch(() => false);

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-9 place-items-center bg-primary text-primary-foreground">
              <FileStackIcon className="size-5" />
            </span>
            <span className="hidden sm:inline">Spyglass</span>
          </Link>
          <form action="/search" className="relative mx-auto hidden w-full max-w-2xl sm:block">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" aria-label="Search files and folders" placeholder="Search the library" className="h-10 bg-muted/60 pl-9" />
          </form>
          <nav className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="sm:hidden" nativeButton={false} render={<Link href="/search" aria-label="Search" />}><SearchIcon /></Button>
            <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/trash" aria-label="Trash" />}><Trash2Icon /></Button>
            {showAudit ? <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/audit" aria-label="Audit log" />}><HistoryIcon /></Button> : null}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="User menu" />}><UserIcon /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel><span className="block truncate">{user.fullName}</span><span className="block truncate text-xs font-normal text-muted-foreground">@{user.username}</span></DropdownMenuLabel>
                <DropdownMenuSeparator />
                <form action={logoutAction}><DropdownMenuItem render={<button type="submit" className="w-full" />}>Sign out</DropdownMenuItem></form>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
