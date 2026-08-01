# Authentication

rad.ar supports per-source authentication that can be configured globally via environment variables or overridden per-request through the API and CLI. This guide covers all supported authentication methods.

---

## Overview

Some job sources require external API credentials (OAuth2 tokens, API keys, etc.). Credentials can be provided in two ways:

| Method | Scope | Best For |
| ------ | ----- | -------- |
| **Environment variables** | Global, applies to all requests | Server deployments, CI/CD |
| **Per-request auth** (`input.auth`) | Single request only | Multi-tenant, dynamic credentials |

**Priority**: Per-request auth always takes precedence over environment variables.

---

## Upwork

Upwork uses the [official Upwork SDK](https://github.com/upwork/node-upwork-oauth2) with OAuth2. Two grant types are supported:

### Grant Types

| Grant Type | Use Case | Required Fields |
| ---------- | -------- | --------------- |
| `client_credentials` | Server-to-server, no user context | `clientId`, `clientSecret` |
| `authorization_code` | User-delegated, access to user data | `clientId`, `clientSecret`, `accessToken`, `refreshToken` |

### Getting Credentials

1. Register at [developers.upwork.com](https://developers.upwork.com)
2. Create an OAuth2 application to obtain your **Client ID** and **Client Secret**
3. For `authorization_code` flow: complete the OAuth2 authorization flow to obtain an **access token** and **refresh token**

### Environment Variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `UPWORK_CLIENT_ID` | Yes (both flows) | OAuth2 application client ID |
| `UPWORK_CLIENT_SECRET` | Yes (both flows) | OAuth2 application client secret |
| `UPWORK_GRANT_TYPE` | No | `client_credentials` or `authorization_code`. Auto-detected if omitted. |
| `UPWORK_ACCESS_TOKEN` | `authorization_code` only | Pre-obtained OAuth2 access token |
| `UPWORK_REFRESH_TOKEN` | `authorization_code` only | Pre-obtained OAuth2 refresh token |

#### Auto-Detection

When `UPWORK_GRANT_TYPE` is omitted, the grant type is inferred:

- If `UPWORK_ACCESS_TOKEN` **and** `UPWORK_REFRESH_TOKEN` are set &rarr; `authorization_code`
- Otherwise &rarr; `client_credentials`

#### Examples

**Client Credentials** (server-to-server):

```env
UPWORK_CLIENT_ID=your_client_id
UPWORK_CLIENT_SECRET=your_client_secret
```

**Authorization Code** (user-delegated):

```env
UPWORK_CLIENT_ID=your_client_id
UPWORK_CLIENT_SECRET=your_client_secret
UPWORK_ACCESS_TOKEN=your_access_token
UPWORK_REFRESH_TOKEN=your_refresh_token
```

### Per-Request Auth via API

Override env vars for a single request by including `auth.upwork` in the request body:

```json
POST /api/jobs/search
{
  "searchTerm": "react developer",
  "siteType": ["upwork"],
  "auth": {
    "upwork": {
      "grantType": "client_credentials",
      "clientId": "your_client_id",
      "clientSecret": "your_client_secret"
    }
  }
}
```

For `authorization_code`:

```json
{
  "auth": {
    "upwork": {
      "grantType": "authorization_code",
      "clientId": "your_client_id",
      "clientSecret": "your_client_secret",
      "accessToken": "your_access_token",
      "refreshToken": "your_refresh_token"
    }
  }
}
```

The `grantType` field is optional in both the API and env vars. When omitted, it is auto-detected using the same logic described above.

### Per-Request Auth via CLI

**Option 1: JSON stdin** (recommended for programmatic usage):

```bash
echo '{
  "searchTerm": "python",
  "siteType": ["upwork"],
  "auth": {
    "upwork": {
      "clientId": "your_client_id",
      "clientSecret": "your_client_secret",
      "grantType": "client_credentials"
    }
  }
}' | npx ever-jobs search --stdin
```

**Option 2: CLI flag**:

```bash
npx ever-jobs search -q "python" -s upwork \
  --upwork-auth-json '{"clientId":"x","clientSecret":"y","grantType":"client_credentials"}'
```

### Auth Resolution Priority

When `UpworkService.scrape()` is called, credentials are resolved in this order:

1. **Per-request** (`input.auth.upwork`) &mdash; if `clientId` + `clientSecret` are present, a fresh API client is created
2. **Environment variables** &mdash; the singleton client created at service startup
3. **None** &mdash; a warning is logged and empty results are returned

---

## Exa

Exa uses a simple API key. Currently only configurable via environment variable:

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `EXA_API_KEY` | Yes | Exa AI search API key |

Per-request auth for Exa can be added in a future release by extending `ScraperAuthDto` with an `exa` property.

---

## The `auth` Field Schema

The `auth` field on `ScraperInputDto` is an optional object keyed by source name:

```typescript
interface ScraperAuthDto {
  upwork?: {
    grantType?: 'client_credentials' | 'authorization_code';
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;   // authorization_code only
    refreshToken?: string;  // authorization_code only
  };
  // Future sources:
  // linkedin?: { ... };
  // exa?: { apiKey?: string };
}
```

Each source property is independently optional. Only include credentials for the source(s) you want to override.

---

## Extending Auth for New Sources

To add per-request auth for a new source:

1. **Create a DTO** in `packages/models/src/dtos/auth/` (e.g., `linkedin-auth.dto.ts`)
2. **Add the property** to `ScraperAuthDto` with `@ValidateNested()` and `@Type()` decorators
3. **Export** from `packages/models/src/dtos/auth/index.ts`
4. **Update the source service** to check `input.auth.<source>` before falling back to env vars
5. **Optionally** add a CLI flag (e.g., `--linkedin-auth-json`)

---

## Security Considerations

- **Always use HTTPS** when sending credentials in request bodies
- **Prefer environment variables** for server deployments to avoid credentials in request logs
- Auth credentials in request bodies are **not logged** by the API controller
- Auth data **is included in cache keys** by design (different credentials may return different results)
- Never commit `.env` files with real credentials to version control
- Rotate credentials periodically and revoke compromised ones
- See [Security Guidelines](./SECURITY_GUIDELINES.md) for additional best practices
