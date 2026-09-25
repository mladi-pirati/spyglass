import { describe, expect, test } from "bun:test";

import { buildStorageKey, normalizeStorageSegment, splitFilename } from "@/lib/storage-path";

describe("storage path normalization", () => {
  test("normalizes spaces and punctuation", () => {
    expect(normalizeStorageSegment("Public Relations", "folder")).toBe("public_relations");
  });

  test("removes Slovenian diacritics", () => {
    expect(normalizeStorageSegment("Šiška promo", "folder")).toBe("siska_promo");
  });

  test("uses a fallback for non-readable names", () => {
    expect(normalizeStorageSegment("🎉", "folder")).toBe("folder");
  });

  test("builds root and replacement keys", () => {
    const id = "12345678-abcd-4000-8000-123456789abc";
    expect(buildStorageKey({ folderSegments: [], itemId: id, filename: "Press Photo.JPG" }))
      .toBe("library/_root/press_photo--12345678.jpg");
    expect(buildStorageKey({ folderSegments: ["public_relations"], itemId: id, filename: "Press Photo.JPG", generation: 2 }))
      .toBe("library/public_relations/press_photo--12345678--v2.jpg");
  });

  test("sanitizes extensions", () => {
    expect(splitFilename("archive.TA R")).toEqual({ basename: "archive", extension: "tar" });
  });
});
