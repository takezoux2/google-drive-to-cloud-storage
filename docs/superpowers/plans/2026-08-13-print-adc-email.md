# Print ADC-authenticated email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the ADC-authenticated account's email to the console every time the CLI runs.

**Architecture:** `createGoogleClients()` in `src/drive/client.ts` calls `GoogleAuth#getCredentials()` on the same `GoogleAuth` instance it already builds, and returns the resolved `client_email` (or `null`) alongside the existing `drive`/`docs`/`sheets` clients. `cli.ts`'s `main()` logs the value right after calling `createGoogleClients()`.

**Tech Stack:** TypeScript, vitest, google-auth-library (`GoogleAuth#getCredentials`).

## Global Constraints

- No new OAuth scopes (per spec: `getCredentials()` needs none).
- `docs/superpowers/specs/2026-08-13-print-adc-email-design.md` is the approved spec — follow it exactly.

---

### Task 1: Return authenticated email from `createGoogleClients`

**Files:**
- Modify: `src/drive/client.ts`
- Test: `src/drive/client.test.ts`

**Interfaces:**
- Produces: `GoogleClients.authenticatedEmail: string | null` — added to the existing `GoogleClients` interface (`drive`, `docs`, `sheets` unchanged).
- Produces: `createGoogleClients(): Promise<GoogleClients>` — same signature, now also populates `authenticatedEmail`.

- [ ] **Step 1: Write the failing tests**

Replace `src/drive/client.test.ts` with:

```typescript
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run src/drive/client.test.ts`
Expected: FAIL — `clients.authenticatedEmail` is `undefined` (property doesn't exist yet), first test still passes.

- [ ] **Step 3: Implement `authenticatedEmail` in `createGoogleClients`**

Replace the contents of `src/drive/client.ts` with:

```typescript
import { GoogleAuth } from "google-auth-library";
import {
  type docs_v1,
  type drive_v3,
  google,
  type sheets_v4,
} from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

export interface GoogleClients {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  sheets: sheets_v4.Sheets;
  authenticatedEmail: string | null;
}

export async function createGoogleClients(): Promise<GoogleClients> {
  const auth = new GoogleAuth({ scopes: SCOPES });
  const authClient = await auth.getClient();
  const credentials = await auth.getCredentials();
  return {
    drive: google.drive({ version: "v3", auth: authClient as never }),
    docs: google.docs({ version: "v1", auth: authClient as never }),
    sheets: google.sheets({ version: "v4", auth: authClient as never }),
    authenticatedEmail: credentials.client_email ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/drive/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/drive/client.ts src/drive/client.test.ts
git commit -m "feat: expose ADC-authenticated email from createGoogleClients"
```

---

### Task 2: Log the authenticated email in the CLI entrypoint

**Files:**
- Modify: `src/cli.ts:17-19`

**Interfaces:**
- Consumes: `GoogleClients.authenticatedEmail: string | null` from Task 1.

- [ ] **Step 1: Update `main()` to log the authenticated email**

In `src/cli.ts`, change:

```typescript
  const config = await loadConfig(options.config);
  const { drive, docs, sheets } = await createGoogleClients();
```

to:

```typescript
  const config = await loadConfig(options.config);
  const { drive, docs, sheets, authenticatedEmail } =
    await createGoogleClients();
  console.log(`Authenticated as: ${authenticatedEmail ?? "unavailable"}`);
```

- [ ] **Step 2: Manually verify**

Run: `pnpm run dev -c config.yaml --dry-run`
Expected: First line of output is `Authenticated as: <email or "unavailable">`, followed by the existing per-mapping sync summary lines.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: print ADC-authenticated email on CLI startup"
```
