# Security

## Threat model (internal ops)

- Staff browser on a trusted company network/VPN (not assumed public SaaS).
- Customer tracking tokens are bearer secrets.
- Uploaded PDFs may contain bank/commercial evidence.

## AuthN

Better Auth email/password. HttpOnly session cookie, SameSite=Lax, Secure when `BETTER_AUTH_URL` is https. No public signup. Bootstrap requires `BOOTSTRAP_SECRET` and only works when zero users exist. The last active root administrator is an active user who still has both `users.manage` and `roles.manage` after role grants and GRANT/DENY overrides. Disabling that user, changing their roles, denying either permission, or stripping those keys from the administrator role returns 409 and restores the previous rows. A principal who has only one of those two permissions cannot change privileges (403).

## AuthZ

Central permission keys. Effective set = union of role grants, then user GRANT/DENY overrides. Server checks every route. `export_cases.view_assigned` is enforced on load, not only menus. Bank details require extra permission.

## CSRF / origin

Mutating `/api/v1` requests must match `BETTER_AUTH_URL` when an Origin header is present. Same-origin SPA cookies.

## Public tracking

Token stored as SHA-256 only. Revoked/expired/unknown → generic 410. Projection DTO omits bank, money internals, notes, files. Referrer-Policy no-referrer. Cache-Control no-store.

Rate limit rows live in D1 (`rate_limit_buckets`). The counter is `INSERT ... ON CONFLICT ... RETURNING hits`, so concurrent requests on one database share one atomic count. The local subject ignores `X-Forwarded-For` and `CF-Connecting-IP`. `CF-Connecting-IP` is used only when `TRUST_CF_CONNECTING_IP=1`, which is the Cloudflare edge trust boundary and is not set in local development. Spoofed forwarding headers therefore share the bucket `direct-untrusted`. This is not a Cloudflare WAF test. WAF remains an owner control before production.

## Uploads

Private R2. Opaque keys. PDF/JPEG/PNG only. Zero-byte files and zero-byte parts are rejected. A completed object must match the session size and the declared signature; mismatches abort the session and delete the object. Download requires `documents.view` and case access. A guessed key for a case the caller cannot access returns a generic 404 (`File not found`), not a message that reveals the case. Attaching a version requires a COMPLETED session owned by the caller whose parent is that exact requirement. Booking and container lists are limited to cases the caller can see.

## Logging

Audit redacts password/token/iban-like keys. Do not log tracking tokens or full financial dumps.
