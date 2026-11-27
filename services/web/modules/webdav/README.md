# WebDAV Integration

This module provides an opt-in WebDAV integration for Nextcloud, ownCloud, and other WebDAV-compliant servers.

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WEBDAV_ENABLED` | Enable/disable the WebDAV module | `true` or `false` (default: `false`) |

### Optional Environment Variables

| Variable | Description | Example | Default |
|----------|-------------|---------|--------|
| `WEBDAV_TOKEN_CIPHER_PASSWORD` | Secret key for encrypting user credentials (REQUIRED in production) | `my-super-secret-key-123` | Generated on startup |
| `WEBDAV_TOKEN_CIPHER_FILE` | Persistent file path for encryption keys | `/var/lib/overleaf/data/.webdav-token-cipher.json` | Auto-created |
| `WEBDAV_TOKEN_CIPHER_LABEL` | Label for the credential-encryption key | `OL_WEBDAV-v3` | `OL_WEBDAV-v3` |

## Setup

### 1. Enable the Module

Add to your `.env` file:
```bash
WEBDAV_ENABLED=true
```

### 2. Configure Encryption

**For Development/Testing:**
The system will auto-generate an encryption key and store it in `/var/lib/overleaf/data/.webdav-token-cipher.json`.

**For Production (REQUIRED):**
Set a secure password (minimum 16 characters recommended):
```bash
WEBDAV_TOKEN_CIPHER_PASSWORD=your-secure-password-minimum-16-chars
```

### 3. Set WebDAV Connection

Users connect via the settings widget or API. The WebDAV root path is supplied with the user's connection details and is not configured by a `WEBDAV_ROOT_PATH` environment variable:
- **Nextcloud**: `https://nextcloud.example.com/remote.php/dav/files/USERNAME`
- **OwnCloud**: `https://owncloud.example.com/remote.php/webdav/`
- **General**: Your WebDAV server URL pointing to user's files directory

## API Endpoints

### User Connection Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/user/webdav/connect` | Connect user to WebDAV server |
| `GET` | `/user/webdav/status` | Get connection status for current user |
| `POST` | `/user/webdav/disconnect` | Disconnect from WebDAV |

### Project Synchronization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/project/:project_id/webdav/state` | Get sync state for a project |
| `POST` | `/project/:project_id/webdav/pull` | Pull remote changes into Overleaf |
| `POST` | `/project/:project_id/webdav/push` | Push local changes to WebDAV |
| `GET` | `/project/:project_id/webdav/files` | List files in project's WebDAV folder |
| `POST` | `/project/:project_id/webdav/conflict/resolve` | Resolve a sync conflict |
| `POST` | `/project/new/webdav` | Create an Overleaf project from a remote WebDAV folder |

**Request Body Example (conflict resolution):**
```json
{
  "path": "/report.tex",
  "choice": "local"
}
```

## Sync Behavior

### Manual Sync Operations

- Click "Pull" to check for and download changes from WebDAV
- Click "Push" to upload local Overleaf changes to WebDAV
- Open a project and use the WebDAV card in the Integrations panel to trigger pull/push operations
- Resolve conflicts via the conflict resolution dialog (keep local or remote)
- Linking a project only stores the connection; it does not start a background or initial sync
- Pull detects remote file deletions and marks a remotely deleted project as deleted by the external source
- New-project import downloads the selected remote folder through the TPDS import pipeline

**Note**: The module uses manual project-page triggers instead of automatic polling. Files are only synchronized when you explicitly click Pull or Push.

## File Sync Strategy

1. **ETag-based comparison** using WebDAV ETags when available
2. **Metadata fallback**: Uses modification time and size when an ETag is unavailable
3. **Remote snapshots**: Stores the last observed remote file state for deletion detection
4. **De-duplication**: Files unchanged since the last pull are not downloaded again

## Conflict Resolution

When a file is modified on both Overleaf and WebDAV:

1. Detection occurs when you click Pull (ETag/hash comparison)
2. Conflicts stored in project's `lastConflict` state
3. User resolves by choosing to keep:
   - **local**: Overleaf's current version
   - **remote**: WebDAV's version

## Encryption

Credentials are encrypted using the [access-token-encryptor](https://github.com/overleaf/overleaf/tree/main/libraries/access-token-encryptor) library. Keys stored in:
- Environment variable: `WEBDAV_TOKEN_CIPHER_PASSWORD` (environment)
- File: `WEBDAV_TOKEN_CIPHER_FILE` or default `/var/lib/overleaf/data/.webdav-token-cipher.json`

**Important**: If using file storage, ensure the path is persistent across container restarts. The retry count and retry delay are currently implementation defaults, not environment parameters.

## Usage Example

### Connect a User to WebDAV

```javascript
// Using curl
curl -X POST http://localhost:3000/user/webdav/connect \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://nextcloud.example.com/remote.php/dav/files/alice",
    "username": "alice",
    "password": "app-password-or-password"
  }'
```

### Pull Remote Changes

```javascript
// Using curl (must be authenticated)
curl -X POST http://localhost:3000/project/12345/webdav/pull \
  -H "Cookie: overleaf_session_id=..."
```

### Check Connection Status

```javascript
curl http://localhost:3000/user/webdav/status
// Response: {"connected": true, "baseUrl": "...", "lastSyncAt": "..."}