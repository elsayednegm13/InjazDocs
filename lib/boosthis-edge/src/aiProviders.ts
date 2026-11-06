/* ─── Boosthis: AI-provider classification (edge isolate) ───────────────────
 *
 * WHY A LIST AND NOT AN ADDRESS. Outbound calls are reduced to counts and
 * durations, and the destination never leaves the isolate. What leaves is a
 * NUMBER from the fixed table below — a classification against a maintained
 * list, never a hostname the customer chose. A call whose destination is not
 * on the list is not "probably AI": it stays ordinary outbound traffic and is
 * never counted here.
 *
 * THE CODE IS THE WIRE FORMAT. `providerCode` is the 1-based position in
 * {@link AI_PROVIDERS}. Positions are permanent: append a new provider, never
 * reorder or delete one, or every stored reading changes meaning. `0` means
 * "no known provider".
 *
 * PARITY. The Node kit (`lib/boosthis-runtime-node/src/aiProviders.ts`) and
 * the Python kit (`boosthis/ai_providers.py`) ship the same table in the same
 * order, and a guard compares the three sources so the same number can never
 * mean two different providers in two kits. This kit cannot import either of
 * them: it declares no dependencies and must load in an isolate that has no
 * module resolution beyond its own bundle.
 *
 * ONLY LLM PROVIDERS. The table is limited to providers that report token
 * usage on a normal reply. An image, speech or embedding-only host would be
 * classified as AI and then permanently reported as "usage not reported",
 * which is a finding about the app that would actually be a fact about the
 * provider — so those hosts stay unclassified on purpose.
 */

/** One entry in the maintained provider list. */
export interface AiProviderEntry {
  /** Stable short name. Display text lives on the server, never here. */
  readonly id: string;
  /** Hostname suffixes that identify this provider's data plane. */
  readonly hosts: readonly string[];
}

/**
 * The maintained list. APPEND ONLY — a provider's position IS its wire code.
 */
export const AI_PROVIDERS: readonly AiProviderEntry[] = [
  { id: "openai", hosts: ["api.openai.com"] },
  { id: "anthropic", hosts: ["api.anthropic.com"] },
  {
    id: "google",
    hosts: [
      "generativelanguage.googleapis.com",
      "aiplatform.googleapis.com",
      ".aiplatform.googleapis.com",
    ],
  },
  {
    id: "azure-openai",
    hosts: [".openai.azure.com", ".cognitiveservices.azure.com"],
  },
  { id: "aws-bedrock", hosts: [".amazonaws.com"] },
  { id: "mistral", hosts: ["api.mistral.ai", "codestral.mistral.ai"] },
  { id: "cohere", hosts: ["api.cohere.ai", "api.cohere.com"] },
  { id: "groq", hosts: ["api.groq.com"] },
  { id: "together", hosts: ["api.together.xyz", "api.together.ai"] },
  { id: "perplexity", hosts: ["api.perplexity.ai"] },
  { id: "deepseek", hosts: ["api.deepseek.com"] },
  { id: "xai", hosts: ["api.x.ai"] },
  { id: "fireworks", hosts: ["api.fireworks.ai"] },
  { id: "openrouter", hosts: ["openrouter.ai"] },
  { id: "replicate", hosts: ["api.replicate.com"] },
  {
    id: "huggingface",
    hosts: ["api-inference.huggingface.co", "router.huggingface.co"],
  },
  { id: "voyage", hosts: ["api.voyageai.com"] },
  { id: "cerebras", hosts: ["api.cerebras.ai"] },
  // THE ENDPOINT THE CUSTOMER RUNS THEMSELVES. Carries no hosts of its own:
  // the table walk can never reach it, and it is assigned only when the
  // destination matches an address the app DECLARED (see below). One code for
  // every such endpoint, so a private address can never be reconstructed from
  // a reading — see {@link declaredAiProviderCode}.
  { id: "declared", hosts: [] },
] as const;

/**
 * Wire code for a customer-declared endpoint. Derived from the table so it
 * cannot drift from the entry above.
 */
export const DECLARED_PROVIDER_CODE =
  AI_PROVIDERS.findIndex((p) => p.id === "declared") + 1;

/**
 * AWS hosts are shared by every AWS service, so the suffix alone would drag
 * S3, SQS and DynamoDB into an AI reading. Bedrock's runtime endpoint is named
 * distinctly, and only that prefix counts.
 */
const AWS_BEDROCK_PREFIXES = ["bedrock-runtime.", "bedrock."] as const;

/**
 * Request paths only an AI inference API serves.
 *
 * A call is classified by its DESTINATION, and a host this kit does not
 * recognise is deliberately not AI: guessing from a hostname would put a CDN,
 * an image resizer and the app's own data proxy into the AI reading. The cost
 * of that rule is silence — a worker whose whole AI layer is a self-hosted
 * model, a private gateway or a regional endpoint shows no AI rows at all,
 * which looks exactly like a worker with no AI in it.
 *
 * This list buys back the difference with POSITIVE EVIDENCE: a POST to
 * `/v1/chat/completions` on an unrecognised host is the OpenAI-compatible
 * inference shape that vLLM, LiteLLM, LM Studio, llama.cpp and every gateway
 * in front of them speak. Seeing one is grounds for saying "there is AI-shaped
 * traffic here I could not classify", and for nothing else: a matched call is
 * never timed, never scored, never counted as an AI call and never priced.
 *
 * Kept byte-identical to the Node kit's list — one dashboard renders both, and
 * two kits that disagree about what an inference shape is would report
 * different counts for the same worker.
 */
export const AI_SHAPED_PATHS: readonly string[] = [
  // OpenAI-compatible — the shape almost every self-hosted server exposes.
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/responses",
  "/v1/embeddings",
  // Anthropic-compatible.
  "/v1/messages",
  // Ollama's native API.
  "/api/generate",
  "/api/chat",
  "/api/embeddings",
  // Hugging Face text-generation-inference.
  "/generate_stream",
];

/**
 * Did this request path have the shape of an AI inference call? Case and a
 * trailing slash are not a disguise. Total and never throws — it runs on the
 * calls that classified to NOTHING, which is most of an app's traffic.
 */
export function isAiShapedPath(path: unknown): boolean {
  try {
    if (typeof path !== "string" || !path) return false;
    const p = path.toLowerCase().replace(/\/+$/, "");
    return p ? AI_SHAPED_PATHS.includes(p) : false;
  } catch {
    return false;
  }
}

/**
 * Classify one outbound destination against the maintained list.
 *
 * Returns the 1-based provider code, or 0 when the destination is not a known
 * AI provider. Pure, total, allocation-light and cheap enough to run on every
 * outbound call. Never throws, and reads nothing but the hostname.
 */
export function aiProviderCode(host: unknown): number {
  try {
    const h = typeof host === "string" ? host.toLowerCase() : "";
    if (!h) return 0;
    for (let i = 0; i < AI_PROVIDERS.length; i++) {
      const entry = AI_PROVIDERS[i]!;
      for (const suffix of entry.hosts) {
        const hit = suffix.startsWith(".")
          ? h.endsWith(suffix) || h === suffix.slice(1)
          : h === suffix;
        if (!hit) continue;
        if (entry.id === "aws-bedrock") {
          // Only Bedrock's own runtime endpoint — never the rest of AWS.
          if (!AWS_BEDROCK_PREFIXES.some((p) => h.startsWith(p))) continue;
        }
        return i + 1;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

/** The stable id behind a code, or `null` for 0/out-of-range. Test + local
 *  use only: the wire carries the code, never this string. */
export function aiProviderId(code: number): string | null {
  if (!Number.isFinite(code)) return null;
  const idx = Math.round(code) - 1;
  return AI_PROVIDERS[idx]?.id ?? null;
}

/* ── The endpoint the customer runs themselves ───────────────────────────── */

/*
 * WHY THIS EXISTS. The table above is a list of companies. An app that calls a
 * model it hosts itself — an OpenAI-compatible server on its own network, a
 * sovereign or regional gateway, a private deployment of an open-weights model
 * — matches nothing in it, and used to have all three AI axes omitted.
 *
 * WHAT DOES NOT CHANGE. The address still never leaves the isolate. What goes
 * on the wire is one fixed-table number shared by every declared endpoint.
 *
 * WHAT WE REFUSE TO DO WITH IT. We do not price these calls from our own table,
 * even when the reply names a model the table knows. Tokens are counted and a
 * cost the endpoint itself reported is taken; guessed money is withheld.
 */

/** Most declared endpoints one install may name. */
export const MAX_DECLARED_AI_ENDPOINTS = 8;
const MAX_HOST_LENGTH = 253;
let declaredHosts: readonly string[] = [];

/** Reduce one declared entry to a bare hostname, or null when unusable. */
export function normaliseDeclaredEndpoint(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;
    let value = raw.trim().toLowerCase();
    if (!value || /\s/.test(value) || value.includes("*")) return null;
    if (value.includes("://")) {
      try {
        value = new URL(value).hostname;
      } catch {
        return null;
      }
    } else {
      const slash = value.indexOf("/");
      if (slash >= 0) value = value.slice(0, slash);
      const at = value.lastIndexOf("@");
      if (at >= 0) value = value.slice(at + 1);
      if (!value.startsWith("[")) {
        const colon = value.lastIndexOf(":");
        if (colon >= 0) value = value.slice(0, colon);
      }
    }
    if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
    if (!value || value.length > MAX_HOST_LENGTH || value.includes("*")) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Replace the declared endpoint list. Bad entries are dropped, duplicates
 * collapse, and only the accepted count is exposed — never the hostnames.
 */
export function setDeclaredAiEndpoints(list: unknown): number {
  try {
    const values = Array.isArray(list) ? list : list == null ? [] : [list];
    const out: string[] = [];
    for (const candidate of values) {
      const host = normaliseDeclaredEndpoint(candidate);
      if (!host || out.includes(host)) continue;
      if (out.length >= MAX_DECLARED_AI_ENDPOINTS) break;
      out.push(host);
    }
    declaredHosts = out;
    return out.length;
  } catch {
    declaredHosts = [];
    return 0;
  }
}

/** Count only: hostnames stay private to this module. */
export function declaredAiEndpointCount(): number {
  return declaredHosts.length;
}

/** Classify against declarations only. Exact hostname match, never a suffix. */
export function declaredAiProviderCode(host: unknown): number {
  try {
    const h = typeof host === "string" ? host.toLowerCase() : "";
    if (!h) return 0;
    const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
    return declaredHosts.includes(bare) ? DECLARED_PROVIDER_CODE : 0;
  } catch {
    return 0;
  }
}

/** Maintained table first, declarations second. This order is deliberate. */
export function aiProviderCodeOrDeclared(host: unknown): number {
  const known = aiProviderCode(host);
  return known !== 0 ? known : declaredAiProviderCode(host);
}

/** Test seam: forget every declaration. */
export function _resetDeclaredAiEndpointsForTests(): void {
  declaredHosts = [];
}

/**
 * Hostname suffixes of databases an app reaches over HTTP.
 *
 * This is the ONLY kind of database an isolate can see. There is no driver to
 * wrap and no socket to watch here, so a project whose data lives behind a
 * TCP driver is invisible to this reading — the dashboard says so in words
 * beside the number rather than letting a partial view read as the whole.
 *
 * Same list, same order as the Node kit's `dbWork.ts`, so one hosted database
 * is classified identically wherever the app runs.
 */
export const HOSTED_DB_HOST_SUFFIXES: readonly string[] = [
  ".supabase.co",
  ".supabase.in",
  ".supabase.net",
  ".firebaseio.com",
  ".firebasedatabase.app",
  "firestore.googleapis.com",
  ".neon.tech",
  ".upstash.io",
  ".turso.io",
  ".turso.tech",
  ".planetscale.com",
  ".psdb.cloud",
  ".cockroachlabs.cloud",
  ".mongodb-api.com",
  ".fauna.com",
  ".xata.sh",
  ".prisma-data.net",
];

/**
 * Path prefixes that identify a hosted database on a host we cannot recognise
 * — a self-hosted Supabase / PostgREST behind the project's own domain. Only
 * consulted when the hostname did not already answer, and only the prefix is
 * examined: the rest of the path (which is where a PostgREST filter carries
 * its column names and values) is never read here.
 */
export const HOSTED_DB_PATH_PREFIXES: readonly string[] = ["/rest/v1/"];

/**
 * Is this outbound call database work rather than ordinary API traffic?
 *
 * Pure, total, and cheap — it runs on every outbound call. Never throws.
 */
export function isHostedDatabaseCall(host: unknown, path: unknown): boolean {
  try {
    const h = typeof host === "string" ? host.toLowerCase() : "";
    if (h) {
      for (const suffix of HOSTED_DB_HOST_SUFFIXES) {
        if (h === suffix || h.endsWith(suffix)) return true;
        // A suffix written with a leading dot also matches the bare apex.
        if (suffix.startsWith(".") && h === suffix.slice(1)) return true;
      }
    }
    const p = typeof path === "string" ? path : "";
    if (p) {
      for (const prefix of HOSTED_DB_PATH_PREFIXES) {
        if (p.startsWith(prefix)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
