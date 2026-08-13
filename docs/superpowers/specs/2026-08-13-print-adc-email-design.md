# Print ADC-authenticated email on CLI run

## Purpose

Print the email address of the Application Default Credentials (ADC) account
to the console every time the CLI runs, so the operator can quickly confirm
which identity is being used before sync operations execute.

## Approach

`createGoogleClients()` in `src/drive/client.ts` already constructs a
`GoogleAuth` instance to obtain an auth client. We reuse that instance and
call `auth.getCredentials()`, which resolves `client_email` for:

- Service account JSON key files
- GCE/Cloud Run/Cloud Functions default service account (metadata server)
- Workload Identity Federation / external accounts

No additional OAuth scopes are required since `getCredentials()` reads the
credential source directly rather than calling the userinfo API.

`gcloud auth application-default login` (personal user ADC) does not have a
`client_email`. In that case the email is reported as unavailable rather than
treated as an error.

## Changes

- `createGoogleClients()` returns an additional `authenticatedEmail: string | null`
  field alongside `drive`, `docs`, `sheets`.
- `cli.ts`'s `main()` logs `Authenticated as: <email>` (or an "unavailable"
  message) right after calling `createGoogleClients()`, before processing any
  mappings.

## Error handling

If `getCredentials()` itself throws, `createGoogleClients()` already fails
before this point via `auth.getClient()`, so no new error handling is needed
beyond the existing top-level `main().catch(...)` in `cli.ts`.

## Out of scope

- Falling back to the OAuth2 userinfo API for user-authenticated ADC.
- A dedicated `--whoami` subcommand.
