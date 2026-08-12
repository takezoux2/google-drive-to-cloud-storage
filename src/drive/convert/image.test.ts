import { describe, expect, it, vi } from "vitest";

const { jpeg, sharpMock } = vi.hoisted(() => {
  const toBuffer = vi.fn().mockResolvedValue(Buffer.from("jpeg-bytes"));
  const jpeg = vi.fn().mockReturnValue({ toBuffer });
  const sharpMock = vi.fn().mockReturnValue({ jpeg });
  return { jpeg, sharpMock };
});

vi.mock("sharp", () => ({ default: sharpMock }));

import { convertToJpeg } from "./image.js";

describe("convertToJpeg", () => {
  it("pipes the input buffer through sharp's jpeg encoder", async () => {
    const input = Buffer.from("input-bytes");

    const result = await convertToJpeg(input);

    expect(sharpMock).toHaveBeenCalledWith(input);
    expect(jpeg).toHaveBeenCalled();
    expect(result.toString()).toBe("jpeg-bytes");
  });
});
