"use client";
/* eslint-disable @next/next/no-img-element -- authenticated originals must bypass the public image optimizer */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  Music2Icon,
  Grid2X2Icon,
  InfoIcon,
  ListIcon,
  MoreHorizontalIcon,
  MoveIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ReplaceIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { createFolderAction, getUploaderNameAction, moveItemAction, renameItemAction, restoreItemAction, trashItemAction } from "@/actions/items";
import type { DriveItem } from "@/db/schema";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type FolderOption = { id: string; name: string; parentId: string | null };
type Transfer = { id: string; name: string; progress: number; state: "uploading" | "done" | "error"; message?: string };
type PendingUpload = { id: string; name: string; size: number; lastModified: number; fingerprint: string; parentId: string | null; replaceItemId?: string };

export function MediaWorkspace({
  title,
  parentId,
  items,
  breadcrumbs,
  folders,
  trash = false,
  search = false,
  nextHref,
}: {
  title: string;
  parentId: string | null;
  items: DriveItem[];
  breadcrumbs: DriveItem[];
  folders: FolderOption[];
  trash?: boolean;
  search?: boolean;
  nextHref?: string;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video" | "audio" | "pdf" | "other">("all");
  const [sort, setSort] = useState<"name" | "newest" | "oldest">("name");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"folder" | "rename" | "move" | null>(null);
  const [active, setActive] = useState<DriveItem | null>(null);
  const [details, setDetails] = useState<DriveItem | null>(null);
  const [uploader, setUploader] = useState<{ itemId: string; name: string } | null>(null);
  const [value, setValue] = useState("");
  const [destination, setDestination] = useState<string>("");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [replacementTarget, setReplacementTarget] = useState<DriveItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [trashTargets, setTrashTargets] = useState<DriveItem[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = localStorage.getItem("spyglass:view");
      if (stored === "grid" || stored === "list") setView(stored);
      const interrupted = readPending().length;
      if (interrupted) toast.info(`${interrupted} interrupted ${interrupted === 1 ? "upload" : "uploads"} can resume when you select the same file again.`);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const detailsFileId = details?.kind === "file" ? details.id : null;
  const detailsUploaderId = details?.kind === "file" ? details.createdByHelmId : null;
  useEffect(() => {
    if (!detailsFileId || !detailsUploaderId) return;
    let current = true;
    void getUploaderNameAction(detailsFileId)
      .then((name) => { if (current) setUploader({ itemId: detailsFileId, name: name ?? detailsUploaderId }); })
      .catch(() => { if (current) setUploader({ itemId: detailsFileId, name: detailsUploaderId }); });
    return () => { current = false; };
  }, [detailsFileId, detailsUploaderId]);

  const visibleItems = useMemo(() => items
    .filter((item) => item.kind === "folder" || typeFilter === "all" || (typeFilter === "other" ? item.preview === "none" : item.preview === typeFilter))
    .sort((left, right) => sort === "name"
      ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      : sort === "newest"
        ? +new Date(right.updatedAt) - +new Date(left.updatedAt)
        : +new Date(left.updatedAt) - +new Date(right.updatedAt)), [items, sort, typeFilter]);
  const folderItems = useMemo(() => visibleItems.filter((item) => item.kind === "folder"), [visibleItems]);
  const fileItems = useMemo(() => visibleItems.filter((item) => item.kind === "file"), [visibleItems]);
  const selectedItems = items.filter((item) => selected.has(item.id));

  function updateView(next: string[]) {
    const candidate = next[0];
    if (candidate === "grid" || candidate === "list") {
      setView(candidate);
      localStorage.setItem("spyglass:view", candidate);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function submitDialog() {
    startTransition(async () => {
      const result = dialog === "folder"
        ? await createFolderAction({ parentId, name: value })
        : dialog === "rename" && active
          ? await renameItemAction({ id: active.id, name: value })
          : dialog === "move"
            ? await moveMany(selectedItems.length ? selectedItems : active ? [active] : [], destination || null)
            : { ok: false as const, message: "Nothing to update." };
      if (!result.ok) { toast.error(result.message); return; }
      toast.success(dialog === "folder" ? "Folder created" : dialog === "rename" ? "Item renamed" : "Item moved");
      setDialog(null); setValue(""); setSelected(new Set()); router.refresh();
    });
  }

  async function moveMany(targets: DriveItem[], nextParent: string | null) {
    for (const item of targets) {
      const result = await moveItemAction({ id: item.id, parentId: nextParent });
      if (!result.ok) return result;
    }
    return { ok: true as const };
  }

  function mutateMany(kind: "trash" | "restore", explicitTargets?: DriveItem[]) {
    const targets = explicitTargets ?? (selectedItems.length ? selectedItems : active ? [active] : []);
    startTransition(async () => {
      for (const item of targets) {
        const result = kind === "trash" ? await trashItemAction(item.id) : await restoreItemAction(item.id);
        if (!result.ok) { toast.error(result.message); return; }
      }
      toast.success(kind === "trash" ? "Moved to trash" : "Restored");
      setSelected(new Set()); setActive(null); router.refresh();
    });
  }

  async function handleFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) await uploadFile(file);
  }

  async function uploadFile(file: File, replaceItem?: DriveItem) {
    const uploadParentId = replaceItem?.parentId ?? parentId;
    const localId = crypto.randomUUID();
    setTransfers((current) => [...current, { id: localId, name: file.name, progress: 0, state: "uploading" }]);
    try {
      const fingerprint = await fingerprintFile(file);
      let pending = readPending().find((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified && entry.parentId === uploadParentId && entry.replaceItemId === replaceItem?.id && entry.fingerprint === fingerprint);
      let session: UploadSession | null = null;
      if (pending) {
        const response = await fetch(`/api/uploads/${pending.id}`);
        if (response.ok) session = await response.json();
        else {
          writePending(readPending().filter((entry) => entry.id !== pending?.id));
          pending = undefined;
        }
      }
      if (!pending) {
        const response = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: uploadParentId, replaceItemId: replaceItem?.id, name: file.name, byteSize: file.size, contentType: file.type || "application/octet-stream", fingerprint }) });
        const body = await response.json() as UploadSession & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Could not start upload.");
        session = body;
        writePending([...readPending(), { id: body.id, name: file.name, size: file.size, lastModified: file.lastModified, parentId: uploadParentId, replaceItemId: replaceItem?.id, fingerprint }]);
      }
      if (!session) throw new Error("Could not restore the upload session.");

      const completed = new Map<number, string>((session.parts ?? []).map((part) => [part.partNumber, part.etag]));
      const missing = Array.from({ length: session.partCount }, (_, index) => index + 1).filter((part) => !completed.has(part));
      let uploadedBytes = [...completed.keys()].reduce((sum, part) => sum + Math.min(session.partSize, file.size - (part - 1) * session.partSize), 0);
      await runWithConcurrency(missing, 4, async (partNumber) => {
        const start = (partNumber - 1) * session.partSize;
        const chunk = file.slice(start, Math.min(start + session.partSize, file.size));
        const response = await fetch(`/api/uploads/${session.id}/parts/${partNumber}`, { method: "PUT", body: chunk });
        const body = await response.json() as { etag?: string; error?: { message?: string } };
        if (!response.ok || !body.etag) throw new Error(body.error?.message ?? `Part ${partNumber} failed.`);
        completed.set(partNumber, body.etag);
        uploadedBytes += chunk.size;
        setTransfers((current) => current.map((transfer) => transfer.id === localId ? { ...transfer, progress: Math.round(uploadedBytes / file.size * 100) } : transfer));
      });
      const response = await fetch(`/api/uploads/${session.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts: [...completed].map(([partNumber, etag]) => ({ partNumber, etag })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not complete upload.");
      writePending(readPending().filter((entry) => entry.id !== session.id));
      setTransfers((current) => current.map((transfer) => transfer.id === localId ? { ...transfer, progress: 100, state: "done" } : transfer));
      toast.success(replaceItem ? `${replaceItem.name} replaced` : `${file.name} uploaded`);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setTransfers((current) => current.map((transfer) => transfer.id === localId ? { ...transfer, state: "error", message } : transfer));
      toast.error(message);
    }
  }

  function handleAction(action: string, item: DriveItem) {
    setActive(item);
    if (action === "rename") { setValue(item.name); setDialog("rename"); }
    else if (action === "move") { setDestination(""); setDialog("move"); }
    else if (action === "replace") { setReplacementTarget(item); replacementInput.current?.click(); }
    else if (action === "trash") setTrashTargets([item]);
    else if (action === "restore") mutateMany("restore", [item]);
  }

  return (
    <div className="space-y-6" onDragEnter={(event) => { event.preventDefault(); if (!trash && !search) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!trash && !search) void handleFiles(event.dataTransfer.files); }}>
      <section className="flex flex-col gap-4 border-b pb-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {breadcrumbs.length ? <Button size="icon-sm" variant="ghost" nativeButton={false} render={<Link href={breadcrumbs.length > 1 ? `/folders/${breadcrumbs.at(-2)!.id}` : "/"} aria-label="Back" />}><ArrowLeftIcon /></Button> : null}
          <Link href="/" className="hover:text-foreground">Library</Link>
          {breadcrumbs.map((crumb) => <span key={crumb.id} className="flex items-center gap-2"><span>/</span><Link href={`/folders/${crumb.id}`} className="max-w-48 truncate hover:text-foreground">{crumb.name}</Link></span>)}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{items.length} {items.length === 1 ? "item" : "items"}</p></div>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="hidden h-9 rounded-lg border bg-background px-2 text-sm sm:block" aria-label="Filter file type"><option value="all">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option><option value="pdf">PDFs</option><option value="other">Other</option></select>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="hidden h-9 rounded-lg border bg-background px-2 text-sm md:block" aria-label="Sort items"><option value="name">Name</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
            {!trash && !search ? <>
              <Button variant="outline" onClick={() => { setValue(""); setDialog("folder"); }}><PlusIcon />New folder</Button>
              <Button onClick={() => fileInput.current?.click()}><UploadIcon />Upload</Button>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.target.value = ""; }} />
              <input ref={replacementInput} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file && replacementTarget) void uploadFile(file, replacementTarget); event.target.value = ""; setReplacementTarget(null); }} />
            </> : null}
            <ToggleGroup value={[view]} onValueChange={updateView} variant="outline" aria-label="View style">
              <ToggleGroupItem value="grid" aria-label="Grid view"><Grid2X2Icon /></ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view"><ListIcon /></ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </section>

      {items.length === 0 ? <EmptyState trash={trash} search={search} onUpload={() => fileInput.current?.click()} /> : view === "grid" ? (
        <div className="space-y-7">
          {folderItems.length ? <ItemSection title="Folders"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{folderItems.map((item) => <FolderCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} onDetails={() => setDetails(item)} onAction={(action) => handleAction(action, item)} trash={trash} />)}</div></ItemSection> : null}
          {fileItems.length ? <ItemSection title="Files"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{fileItems.map((item) => <FileCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} onDetails={() => setDetails(item)} onAction={(action) => handleAction(action, item)} trash={trash} />)}</div></ItemSection> : null}
        </div>
      ) : <ItemTable items={visibleItems} selected={selected} toggle={toggle} setDetails={setDetails} onAction={handleAction} trash={trash} />}

      {selected.size ? <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-background p-2 shadow-xl"><Badge variant="secondary">{selected.size} selected</Badge>{!trash ? <><Button size="sm" variant="outline" onClick={() => { setDestination(""); setDialog("move"); }}><MoveIcon />Move</Button><Button size="sm" variant="destructive" disabled={isPending} onClick={() => setTrashTargets(selectedItems)}><Trash2Icon />Trash</Button></> : <Button size="sm" onClick={() => mutateMany("restore")}><RotateCcwIcon />Restore</Button>}<Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())}><XIcon /></Button></div> : null}

      <AlertDialog open={trashTargets !== null} onOpenChange={(open) => { if (!open) setTrashTargets(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Move to trash?</AlertDialogTitle><AlertDialogDescription>{trashTargets?.length === 1 ? `“${trashTargets[0].name}”` : `${trashTargets?.length ?? 0} items`} will remain restorable for 30 days.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={isPending} onClick={() => { const targets = trashTargets ?? []; setTrashTargets(null); mutateMany("trash", targets); }}>Move to trash</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog === "folder" ? "Create folder" : dialog === "rename" ? "Rename item" : "Move items"}</DialogTitle><DialogDescription>{dialog === "move" ? "Choose a destination folder. Existing S3 keys remain unchanged." : "Names are unique within the current folder."}</DialogDescription></DialogHeader>
          {dialog === "move" ? <select value={destination} onChange={(event) => setDestination(event.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">Library root</option>{folders.filter((folder) => !selected.has(folder.id) && folder.id !== active?.id).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select> : <Input value={value} onChange={(event) => setValue(event.target.value)} autoFocus onKeyDown={(event) => { if (event.key === "Enter") submitDialog(); }} />}
          <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={isPending || (dialog !== "move" && !value.trim())} onClick={submitDialog}>{isPending ? "Saving…" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={details !== null} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <SheetContent><SheetHeader><SheetTitle className="pr-8 break-words">{details?.name}</SheetTitle><SheetDescription>Item information</SheetDescription></SheetHeader>{details ? <><dl className="grid gap-4 px-4 text-sm"><Detail label="Path" value={search ? "Open the item to resolve its current path" : `/${[...breadcrumbs.map((entry) => entry.name), details.name].join("/")}`} /><Detail label="Type" value={details.kind === "folder" ? "Folder" : details.mimeType ?? "Unknown"} /><Detail label="Size" value={formatBytes(details.byteSize)} /><Detail label="Uploaded" value={formatDate(details.createdAt)} />{details.kind === "file" ? <Detail label="Uploaded by" value={uploader?.itemId === details.id ? uploader.name : "Loading…"} /> : null}<Detail label="Modified" value={formatDate(details.updatedAt)} /><Detail label="Helm actor ID" value={details.updatedByHelmId} /><Detail label="S3 key" value={details.storageKey ?? "—"} mono /></dl><div className="flex flex-wrap gap-2 px-4">{!trash ? <Button variant="outline" nativeButton={false} render={<Link href={details.kind === "folder" ? `/folders/${details.id}` : `/files/${details.id}`} />}>Open</Button> : null}{!trash && details.kind === "file" ? <Button variant="outline" nativeButton={false} render={<a href={`/api/files/${details.id}/content?download=1`} />}><DownloadIcon />Download</Button> : null}</div></> : null}</SheetContent>
      </Sheet>

      {transfers.length ? <TransferPanel transfers={transfers} dismiss={() => setTransfers((current) => current.filter((transfer) => transfer.state === "uploading"))} /> : null}
      {nextHref ? <div className="flex justify-end"><Button variant="outline" nativeButton={false} render={<Link href={nextHref} />}>Next page</Button></div> : null}
      {dragging ? <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center border-4 border-dashed border-primary bg-background/90 backdrop-blur-sm"><div className="text-center"><UploadIcon className="mx-auto mb-4 size-12 text-primary" /><p className="text-xl font-semibold">Drop files to upload</p><p className="mt-1 text-sm text-muted-foreground">Uploads will be added to {title}.</p></div></div> : null}
    </div>
  );
}

function ItemSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">{title}</h2>{children}</section>; }

function FolderCard({ item, selected, onToggle, onDetails, onAction, trash }: CardProps) {
  return <ContextMenu><ContextMenuTrigger className={`group relative flex items-center gap-3 rounded-xl border bg-card p-3 transition hover:border-primary/50 hover:shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}><Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${item.name}`} /><Link href={trash ? "#" : `/folders/${item.id}`} className="flex min-w-0 flex-1 items-center gap-3"><FolderIcon className="size-8 fill-primary/20 text-primary" /><span className="truncate text-sm font-medium">{item.name}</span></Link><ItemMenu item={item} onDetails={onDetails} onAction={onAction} trash={trash} /></ContextMenuTrigger><ContextMenuContent><ItemMenuEntries item={item} onDetails={onDetails} onAction={onAction} trash={trash} context /></ContextMenuContent></ContextMenu>;
}

function FileCard({ item, selected, onToggle, onDetails, onAction, trash }: CardProps) {
  return <ContextMenu><ContextMenuTrigger className={`group relative overflow-hidden rounded-xl border bg-card transition hover:border-primary/50 hover:shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>{!trash ? <Link href={`/files/${item.id}`} className="absolute inset-0 z-[1]" aria-label={`Open ${item.name}`} /> : null}<div className="relative aspect-[4/3] overflow-hidden bg-muted"><div className="absolute left-3 top-3 z-10"><Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${item.name}`} /></div>{item.preview === "image" && !trash ? <img src={`/api/files/${item.id}/content`} alt="" loading="lazy" className="size-full object-cover" /> : <div className="grid size-full place-items-center">{iconFor(item, "size-12")}</div>}<div className="absolute right-2 top-2 z-10"><ItemMenu item={item} onDetails={onDetails} onAction={onAction} trash={trash} /></div></div><div className="p-3"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatBytes(item.byteSize)}</p></div></ContextMenuTrigger><ContextMenuContent><ItemMenuEntries item={item} onDetails={onDetails} onAction={onAction} trash={trash} context /></ContextMenuContent></ContextMenu>;
}

type CardProps = { item: DriveItem; selected: boolean; onToggle: () => void; onDetails: () => void; onAction: (action: string) => void; trash: boolean };

function ItemMenu({ item, onDetails, onAction, trash }: { item: DriveItem; onDetails: () => void; onAction: (action: string) => void; trash: boolean }) {
  return <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="secondary" aria-label={`Actions for ${item.name}`} />}><MoreHorizontalIcon /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48 min-w-48"><ItemMenuEntries item={item} onDetails={onDetails} onAction={onAction} trash={trash} /></DropdownMenuContent></DropdownMenu>;
}

function ItemMenuEntries({ item, onDetails, onAction, trash, context = false }: { item: DriveItem; onDetails: () => void; onAction: (action: string) => void; trash: boolean; context?: boolean }) {
  const MenuItem = context ? ContextMenuItem : DropdownMenuItem;
  return <>{!trash && item.kind === "file" ? <><MenuItem render={<a href={`/api/files/${item.id}/content?download=1`} />}><DownloadIcon />Download</MenuItem><MenuItem onClick={() => onAction("replace")}><ReplaceIcon />Replace file</MenuItem></> : null}<MenuItem onClick={onDetails}><InfoIcon />Details</MenuItem>{trash ? <MenuItem onClick={() => onAction("restore")}><RotateCcwIcon />Restore</MenuItem> : <><MenuItem onClick={() => onAction("rename")}><PencilIcon />Rename</MenuItem><MenuItem onClick={() => onAction("move")}><MoveIcon />Move</MenuItem><MenuItem variant="destructive" onClick={() => onAction("trash")}><Trash2Icon />Move to trash</MenuItem></>}</>;
}

function ItemTable({ items, selected, toggle, setDetails, onAction, trash }: { items: DriveItem[]; selected: Set<string>; toggle: (id: string) => void; setDetails: (item: DriveItem) => void; onAction: (action: string, item: DriveItem) => void; trash: boolean }) {
  return <div className="overflow-hidden rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead className="w-12" /><TableHead>Name</TableHead><TableHead className="hidden md:table-cell">Type</TableHead><TableHead className="hidden sm:table-cell">Size</TableHead><TableHead className="hidden lg:table-cell">Modified</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}><TableCell><Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} /></TableCell><TableCell><Link href={trash ? "#" : item.kind === "folder" ? `/folders/${item.id}` : `/files/${item.id}`} className="flex items-center gap-3 font-medium">{iconFor(item, "size-5")}<span className="max-w-[40vw] truncate">{item.name}</span></Link></TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{item.kind === "folder" ? "Folder" : item.mimeType}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{formatBytes(item.byteSize)}</TableCell><TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(item.updatedAt)}</TableCell><TableCell><ItemMenu item={item} onDetails={() => setDetails(item)} onAction={(action) => onAction(action, item)} trash={trash} /></TableCell></TableRow>)}</TableBody></Table></div>;
}

function EmptyState({ trash, search, onUpload }: { trash: boolean; search: boolean; onUpload: () => void }) { return <div className="grid min-h-[45vh] place-items-center rounded-2xl border border-dashed bg-card/50 p-8 text-center"><div className="max-w-sm"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-primary/10 text-primary">{trash ? <Trash2Icon /> : search ? <FileIcon /> : <UploadIcon />}</div><h2 className="font-semibold">{trash ? "Trash is empty" : search ? "No matching items" : "The library is ready"}</h2><p className="mt-2 text-sm text-muted-foreground">{trash ? "Items stay here for 30 days before permanent removal." : search ? "Try a different search term." : "Drop files anywhere or create the first folder."}</p>{!trash && !search ? <Button className="mt-5" onClick={onUpload}><UploadIcon />Upload files</Button> : null}</div></div>; }

function TransferPanel({ transfers, dismiss }: { transfers: Transfer[]; dismiss: () => void }) { return <aside className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-background shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-3"><p className="text-sm font-semibold">Transfers</p><Button size="icon-sm" variant="ghost" onClick={dismiss}><XIcon /></Button></div><div className="max-h-72 space-y-3 overflow-auto p-4">{transfers.map((transfer) => <div key={transfer.id}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate">{transfer.name}</span><span className={transfer.state === "error" ? "text-destructive" : "text-muted-foreground"}>{transfer.state === "error" ? "Failed" : `${transfer.progress}%`}</span></div><Progress value={transfer.progress} />{transfer.message ? <p className="mt-1 text-xs text-destructive">{transfer.message}</p> : null}</div>)}</div></aside>; }

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className={`mt-1 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>; }

function iconFor(item: DriveItem, className: string) { if (item.kind === "folder") return <FolderIcon className={`${className} text-primary`} />; if (item.preview === "image") return <FileImageIcon className={`${className} text-sky-500`} />; if (item.preview === "video") return <FilmIcon className={`${className} text-violet-500`} />; if (item.preview === "audio") return <Music2Icon className={`${className} text-emerald-500`} />; if (item.preview === "pdf") return <FileTextIcon className={`${className} text-red-500`} />; return <FileIcon className={`${className} text-muted-foreground`} />; }

function formatBytes(value: number | null) { if (value === null) return "—"; const units = ["B", "KB", "MB", "GB"]; let size = value; let unit = 0; while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; } return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`; }
function formatDate(value: Date) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

async function fingerprintFile(file: File) { const sampleSize = 64 * 1024; const first = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer()); const last = new Uint8Array(await file.slice(Math.max(0, file.size - sampleSize)).arrayBuffer()); const combined = new Uint8Array(first.length + last.length + 16); combined.set(first); combined.set(last, first.length); new DataView(combined.buffer).setBigUint64(first.length + last.length, BigInt(file.size)); new DataView(combined.buffer).setBigUint64(first.length + last.length + 8, BigInt(file.lastModified)); const digest = await crypto.subtle.digest("SHA-256", combined); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function runWithConcurrency<T>(values: T[], concurrency: number, operation: (value: T) => Promise<void>) { let index = 0; await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => { while (index < values.length) { const current = values[index++]; await operation(current); } })); }
function readPending(): PendingUpload[] { try { return JSON.parse(localStorage.getItem("spyglass:uploads") ?? "[]") as PendingUpload[]; } catch { return []; } }
function writePending(value: PendingUpload[]) { localStorage.setItem("spyglass:uploads", JSON.stringify(value)); }
type UploadSession = { id: string; itemId: string; name: string; byteSize: number; partSize: number; partCount: number; expiresAt: string; fingerprint: string | null; parts?: Array<{ partNumber: number; etag: string; size: number }> };
