import { describe, expect, it, vi } from "vitest";

const { getClient, getCredentials, driveFactory, docsFactory, sheetsFactory } =
  vi.hoisted(() => {
    const getClient = vi.fn().mockResolvedValue({ fake: "auth-client" });
    const getCredentials = vi.fn().mockResolvedValue({
      client_email: "sa@my-project.iam.gserviceaccount.com",
    });
    const driveFactory = vi.fn().mockReturnValue({ fake: "drive" });
    const docsFactory = vi.fn().mockReturnValue({ fake: "docs" });
    const sheetsFactory = vi.fn().mockReturnValue({ fake: "sheets" });
    return {
      getClient,
      getCredentials,
      driveFactory,
      docsFactory,
      sheetsFactory,
    };
  });

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function (this: Record<string, unknown>) {
    this.getClient = getClient;
    this.getCredentials = getCredentials;
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

  it("returns the client_email from getCredentials as authenticatedEmail", async () => {
    const clients = await createGoogleClients();

    expect(getCredentials).toHaveBeenCalled();
    expect(clients.authenticatedEmail).toBe(
      "sa@my-project.iam.gserviceaccount.com",
    );
  });

  it("returns null authenticatedEmail when client_email is absent", async () => {
    getCredentials.mockResolvedValueOnce({});

    const clients = await createGoogleClients();

    expect(clients.authenticatedEmail).toBeNull();
  });
});
