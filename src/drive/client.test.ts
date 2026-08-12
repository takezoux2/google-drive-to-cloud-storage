import { describe, expect, it, vi } from "vitest";

const { getClient, driveFactory, docsFactory, sheetsFactory } = vi.hoisted(
  () => {
    const getClient = vi.fn().mockResolvedValue({ fake: "auth-client" });
    const driveFactory = vi.fn().mockReturnValue({ fake: "drive" });
    const docsFactory = vi.fn().mockReturnValue({ fake: "docs" });
    const sheetsFactory = vi.fn().mockReturnValue({ fake: "sheets" });
    return { getClient, driveFactory, docsFactory, sheetsFactory };
  },
);

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function (this: Record<string, unknown>) {
    this.getClient = getClient;
  }),
}));
vi.mock("googleapis", () => ({
  google: {
    drive: driveFactory,
    docs: docsFactory,
    sheets: sheetsFactory,
  },
}));

import { GoogleAuth } from "google-auth-library";
import { createGoogleClients } from "./client.js";

describe("createGoogleClients", () => {
  it("authenticates with the expected scopes and returns all three clients", async () => {
    const clients = await createGoogleClients();

    expect(GoogleAuth).toHaveBeenCalledWith({
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });
    expect(getClient).toHaveBeenCalled();
    expect(clients.drive).toEqual({ fake: "drive" });
    expect(clients.docs).toEqual({ fake: "docs" });
    expect(clients.sheets).toEqual({ fake: "sheets" });
  });
});
