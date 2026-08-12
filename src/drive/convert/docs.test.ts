import { describe, expect, it, vi } from "vitest";

vi.mock("docs-markdown", () => ({
  googleDocsToMarkdown: vi.fn(
    () =>
      "# Title\n\n![alt text](https://example.com/image.png)\n\nBody text\n",
  ),
}));

import { convertDocToMarkdown } from "./docs.js";

describe("convertDocToMarkdown", () => {
  it("converts the document and strips embedded images", () => {
    const markdown = convertDocToMarkdown({} as never);

    expect(markdown).toContain("# Title");
    expect(markdown).toContain("Body text");
    expect(markdown).not.toContain("![alt text]");
  });
});
