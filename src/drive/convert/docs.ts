import { googleDocsToMarkdown } from "docs-markdown";
import type { docs_v1 } from "googleapis";

export function convertDocToMarkdown(
  document: docs_v1.Schema$Document,
): string {
  const markdown = googleDocsToMarkdown(
    document as unknown as Record<string, unknown>,
  );
  return stripImages(markdown);
}

function stripImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)\n?/g, "");
}
