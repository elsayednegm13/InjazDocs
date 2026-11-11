interface CloudflareBindings {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  BOOTSTRAP_SECRET: string;
  APP_NAME: string;
  COMPANY_TIMEZONE: string;
  INCOTERMS_EDITION_DEFAULT: string;
  MAX_UPLOAD_BYTES: string;
  UPLOAD_PART_SIZE_BYTES: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_S3_ENDPOINT?: string;
  /** Lifetime of a presigned R2 part URL in seconds. Defaults to 3600. */
  R2_SIGNED_URL_TTL_SECONDS?: string;
  /** Set to "1" only behind Cloudflare's proxy, where CF-Connecting-IP is overwritten by the edge. */
  TRUST_CF_CONNECTING_IP?: string;
  /** Local E2E only. Enables a deliberate constraint fault inside invoice correction. */
  EXPORTFLOW_TEST_FAULTS?: string;
  /** Local E2E only. Honors x-test-delay-ms and x-test-delay-after-commit-ms when exactly "true". */
  ALLOW_TEST_DELAY_HEADERS?: string;
  EXPORTFLOW_TRACE?: string;
  /** Non-secret fixture label used to prove which local vars file a diagnostic worker loaded. */
  EXPORTFLOW_FIXTURE?: string;
}

declare namespace Cloudflare {
  interface Env extends CloudflareBindings {}
}

interface Env extends CloudflareBindings {}
