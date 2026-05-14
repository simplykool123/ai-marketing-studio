# AI Marketing Studio Storage Policy

This policy defines the current MVP storage behavior and the planned Google Drive archive path. It is intentionally non-destructive in V1.

## Storage Roles

- Supabase Storage is the active working store for the app.
- The current active bucket is `post-images`.
- Google Drive is planned as a long-term archive provider for older published media.
- Google Drive is optional; the app must remain usable without a Drive connection.

## Current Supabase Usage

Current media is stored in Supabase Storage, mostly in `post-images`:

- Generated Image Studio images: `generated/{clientId}/...`
- Composed occasion/final artwork PNGs: `generated/{clientId}/occasion-artwork-...`
- Uploaded draft/final post images: `posts/{clientId}/...`
- Branded/generated image route output: `branded/{clientId}/...`
- Brand importer assets: `assets/{clientId}/...`
- Durable Video Studio review saves: `videos/{clientId}/...`

Posts can also reference media through `contentSchema` fields such as `finalArtworkUrl`, `videoUrl`, `imageUrl`, `generatedImageUrl`, and `backgroundImageUrl`, plus legacy post columns such as `selectedImageUrl`, `originalImageUrl`, and `brandedImageUrl`.

## Archive Metadata

Archive state should be stored without a schema change in `posts.contentSchema.archive`:

```json
{
  "archiveStatus": "active",
  "archiveProvider": "google_drive",
  "archiveFileId": "drive-file-id",
  "archiveUrl": "https://drive.google.com/...",
  "archivedAt": "2026-05-14T00:00:00.000Z",
  "originalSupabaseUrl": "https://project.supabase.co/storage/v1/object/public/post-images/...",
  "error": "optional failure message"
}
```

Allowed `archiveStatus` values:

- `active`: media still lives in active Supabase working storage.
- `archived`: media was copied to Google Drive and metadata was saved.
- `archive_failed`: archive attempt failed and Supabase media was preserved.

## V1 Archive Rules

- Do not delete Supabase files automatically.
- Do not require Google Drive connection to use the app.
- Do not auto-import or auto-archive media.
- Only published media can be archived.
- Published media is archive-eligible after 7 days by default.
- A 14-day threshold is safer for real client operations if active revisions are still common.
- Draft and scheduled media must never be deleted.
- Videos require explicit user save before they enter app storage.
- Deletion can only be considered in a later phase after a successful archive has been verified.

## Future Cleanup Job

A later cleanup job can be considered only after:

- Google Drive OAuth/token storage is implemented safely.
- Drive uploads return durable file IDs and URLs.
- `contentSchema.archive.archiveStatus` is saved as `archived`.
- The original Supabase object path is retained.
- A human-facing restore/audit path exists.
- Cleanup has a dry-run mode and never processes drafts or scheduled posts.

## Bucket Policy

Current production bucket expectations:

- `post-images`: public, active, 50 MB limit, supports `image/*`, `video/*`, and `application/pdf`.
- `brand-assets`: public, image-only, reserved for future separation. Current app code still stores brand imports under `post-images/assets/...`.

Keep Supabase as the source for active workflows. Treat Google Drive as an archive copy, not as the live media delivery path.
