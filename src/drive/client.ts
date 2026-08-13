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
