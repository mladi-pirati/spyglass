import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSpyglassAccess } from "@/lib/auth/access";
import { listAuditEvents } from "@/lib/drive";
import { getHelm } from "@/lib/helm";
import { canViewAudit } from "@/lib/helm-internal";

const ACTIONS = ["folder.created", "upload.started", "file.uploaded", "file.replaced", "upload.aborted", "upload.expired", "item.renamed", "item.moved", "item.trashed", "item.restored", "item.purged", "storage.object-deleted"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireSpyglassAccess();
  if (!(await canViewAudit(user.roles).catch(() => false))) redirect("/");
  const params = await searchParams;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  const [{ events, nextCursor }, memberNames] = await Promise.all([
    listAuditEvents({ action: params.action || undefined, actor: params.actor || undefined, query: params.q || undefined, from, to, cursor: params.cursor }),
    getMemberNames(user.accessToken),
  ]);
  const nextParams = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return <div className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Restricted</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Audit log</h1><p className="mt-1 text-sm text-muted-foreground">Immutable history of successful changes to the shared library.</p></div>
    <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
      <Input name="q" defaultValue={params.q} placeholder="Target name or ID" />
      <Input name="actor" defaultValue={params.actor} placeholder="Helm member ID" />
      <select name="action" defaultValue={params.action ?? ""} className="h-8 rounded-lg border bg-background px-2 text-sm"><option value="">All actions</option>{ACTIONS.map((action) => <option key={action}>{action}</option>)}</select>
      <Input name="from" defaultValue={params.from} type="date" aria-label="From date" />
      <div className="flex gap-2"><Input name="to" defaultValue={params.to} type="date" aria-label="To date" /><Button type="submit">Filter</Button></div>
    </form>
    <div className="overflow-hidden rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead className="hidden xl:table-cell">Context</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{event.occurredAt.toLocaleString()}</TableCell><TableCell><span className="text-sm">{event.actorType === "system" ? "System" : memberNames.get(event.actorHelmId ?? "") ?? event.actorHelmId}</span></TableCell><TableCell><Badge variant="outline" className="font-mono text-[10px]">{event.action}</Badge></TableCell><TableCell><p className="max-w-64 truncate text-sm font-medium">{event.targetName ?? event.targetId ?? "—"}</p><p className="text-xs text-muted-foreground">{event.targetType}</p></TableCell><TableCell className="hidden max-w-xl xl:table-cell"><code className="line-clamp-2 break-all text-[10px] text-muted-foreground">{JSON.stringify(event.context)}</code></TableCell></TableRow>)}</TableBody></Table>{events.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">No audit events match these filters.</p> : null}</div>
    {nextCursor ? <div className="flex justify-end"><Button variant="outline" nativeButton={false} render={<Link href={`/audit?${nextParams.toString()}`} />}>Next page</Button></div> : null}
  </div>;
}

function parseDate(value?: string, endOfDay = false) { if (!value) return undefined; const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`); return Number.isNaN(date.getTime()) ? undefined : date; }

async function getMemberNames(token: string) {
  const names = new Map<string, string>();
  try {
    const helm = await getHelm(token);
    for await (const page of helm.user.members.paginate({ status: "all", limit: 100, sort: "name-asc" })) {
      for (const member of page) names.set(member.id, `${member.firstName} ${member.lastName}`.trim() || `@${member.username}`);
    }
  } catch { /* IDs remain as the fail-safe historical identity. */ }
  return names;
}
