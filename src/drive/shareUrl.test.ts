import { describe, expect, it } from "vitest";
import { toShareUrl } from "./shareUrl.js";

describe("toShareUrl", () => {
  it("rewrites the usp parameter of a webViewLink to sharing", () => {
    expect(
      toShareUrl(
        "https://docs.google.com/document/d/1SDDg4I/edit?usp=drivesdk",
        "fallback",
      ),
    ).toBe("https://docs.google.com/document/d/1SDDg4I/edit?usp=sharing");
  });

  it("adds usp=sharing when the webViewLink has no query", () => {
    expect(
      toShareUrl("https://drive.google.com/file/d/abc/view", "fallback"),
    ).toBe("https://drive.google.com/file/d/abc/view?usp=sharing");
  });

  it("falls back when the webViewLink is missing", () => {
    expect(toShareUrl(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when the webViewLink is not a valid URL", () => {
    expect(toShareUrl("not a url", "fallback")).toBe("fallback");
  });
});
