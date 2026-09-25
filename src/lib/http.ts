export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configuredOrigin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : new URL(request.url).origin;
  if (origin && origin !== configuredOrigin) throw new Error("Cross-origin mutation rejected.");
}

export function contentDisposition(filename: string, attachment: boolean) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${attachment ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function isSatisfiableSingleRange(range: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) return Number(match[2]) > 0;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  return Number.isSafeInteger(start) && start < size && (end === undefined || (Number.isSafeInteger(end) && end >= start));
}
