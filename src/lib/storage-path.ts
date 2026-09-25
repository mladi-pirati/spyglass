const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ASCII_WORD = /[^a-z0-9]+/g;
const MAX_READABLE_LENGTH = 80;

export function normalizeStorageSegment(value: string, fallback: "file" | "folder") {
  const normalized = value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_ASCII_WORD, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_READABLE_LENGTH)
    .replace(/_+$/g, "");

  return normalized || fallback;
}

export function shortItemId(id: string) {
  return id.replaceAll("-", "").slice(0, 8).toLowerCase();
}

export function splitFilename(filename: string) {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return { basename: filename, extension: "" };
  }

  const extension = filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);

  return { basename: filename.slice(0, dot), extension };
}

export function buildStorageKey(input: {
  folderSegments: string[];
  itemId: string;
  filename: string;
  generation?: number;
}) {
  const { basename, extension } = splitFilename(input.filename);
  const readable = normalizeStorageSegment(basename, "file");
  const generation = input.generation ?? 1;
  const version = generation > 1 ? `--v${generation}` : "";
  const file = `${readable}--${shortItemId(input.itemId)}${version}${extension ? `.${extension}` : ""}`;
  const path = input.folderSegments.length ? input.folderSegments : ["_root"];
  return ["library", ...path, file].join("/");
}
