import sharp from "sharp";

export async function convertToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input).jpeg().toBuffer();
}
