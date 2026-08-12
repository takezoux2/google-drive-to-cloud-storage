import { describe, expect, it } from "vitest";
import { classifyMimeType } from "./classify.js";

describe("classifyMimeType", () => {
  it("classifies Google Docs as markdown conversion", () => {
    expect(classifyMimeType("application/vnd.google-apps.document")).toBe(
      "google-doc-to-markdown",
    );
  });

  it("classifies Google Sheets as csv conversion", () => {
    expect(classifyMimeType("application/vnd.google-apps.spreadsheet")).toBe(
      "google-sheet-to-csv",
    );
  });

  it("excludes Google Slides", () => {
    expect(classifyMimeType("application/vnd.google-apps.presentation")).toBe(
      "excluded",
    );
  });

  it("copies pdf as-is", () => {
    expect(classifyMimeType("application/pdf")).toBe("copy");
  });

  it("copies plain text as-is", () => {
    expect(classifyMimeType("text/plain")).toBe("copy");
  });

  it("copies png as-is", () => {
    expect(classifyMimeType("image/png")).toBe("copy");
  });

  it("converts webp to jpeg", () => {
    expect(classifyMimeType("image/webp")).toBe("image-convert-to-jpeg");
  });

  it("converts heic to jpeg", () => {
    expect(classifyMimeType("image/heic")).toBe("image-convert-to-jpeg");
  });

  it("excludes unknown types", () => {
    expect(classifyMimeType("application/octet-stream")).toBe("excluded");
  });
});
