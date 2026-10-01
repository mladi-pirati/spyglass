// Keep server logs useful without printing request bodies, object keys, or signed URLs.
export function errorDiagnostics(error: unknown) {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = details.cause && typeof details.cause === "object" ? details.cause as Record<string, unknown> : {};
  const metadata = details.$metadata && typeof details.$metadata === "object" ? details.$metadata as Record<string, unknown> : {};
  return {
    name: typeof details.name === "string" ? details.name : "UnknownError",
    code: typeof details.code === "string" ? details.code : undefined,
    causeCode: typeof cause.code === "string" ? cause.code : undefined,
    httpStatusCode: typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined,
    storageRequestId: typeof metadata.requestId === "string" ? metadata.requestId : undefined,
  };
}
