/**
 * Server side access to Viktor's tool gateway.
 *
 * Every integration call in this app runs here, on a schedule, and writes
 * its results into Convex. Screens read Convex only, so end users never
 * inherit anyone's integration access and no page load waits on an API.
 */
declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

export async function callTool<T>(
  role: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${VIKTOR_API_URL}/api/viktor-spaces/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: PROJECT_NAME,
      project_secret: PROJECT_SECRET,
      role,
      arguments: args,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error ?? "Tool call failed");
  }
  return json.result as T;
}

type ArboStarEnvelope = {
  status?: string;
  total?: number;
  total_rows?: number;
  data?: unknown[];
};

/** GET against the ArboStar API through the gateway. */
export async function arbostarGet(
  path: string,
  queryParams: Record<string, string | number>,
): Promise<ArboStarEnvelope> {
  const raw = await callTool<unknown>("mcp_custom_api_arbostar_crm_get", {
    path,
    query_params: Object.fromEntries(
      Object.entries(queryParams).map(([k, val]) => [k, String(val)]),
    ),
    // ArboStar's nginx rejects default client user agents with a 403.
    headers: { "User-Agent": "ArboStar-Viktor-Integration/1.0" },
    timeout_ms: 30000,
  });
  return unwrapJson(raw) as ArboStarEnvelope;
}

/**
 * The gateway returns either the parsed payload or an MCP style envelope
 * with the body as text. Accept both so a gateway change cannot silently
 * turn a real response into an empty sync.
 */
export function unwrapJson(raw: unknown): unknown {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Gateway envelope: { response_role, content: "<json text>" } where the
    // text holds { status_code, url, headers, body }.
    if (typeof obj.content === "string") {
      const parsed = JSON.parse(obj.content) as Record<string, unknown>;
      const status = Number(parsed.status_code ?? 200);
      if (status >= 400) {
        throw new Error(`HTTP ${status} from ${String(parsed.url ?? "integration")}`);
      }
      return parsed.body !== undefined ? parsed.body : parsed;
    }
    if (obj.body !== undefined && typeof obj.body !== "string") return obj.body;
    if (typeof obj.body === "string") return JSON.parse(obj.body);
    if (typeof obj.text === "string") {
      try {
        return JSON.parse(obj.text);
      } catch {
        // fall through
      }
    }
    if (Array.isArray(obj.content)) {
      const first = obj.content[0] as Record<string, unknown> | undefined;
      if (first && typeof first.text === "string") return JSON.parse(first.text);
    }
    if (obj.data !== undefined || obj.status !== undefined) return obj;
    if (obj.result !== undefined) return unwrapJson(obj.result);
  }
  if (typeof raw === "string") return JSON.parse(raw);
  return raw;
}
