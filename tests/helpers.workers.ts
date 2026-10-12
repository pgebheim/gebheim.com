import { env } from "cloudflare:test";

/**
 * Shared scaffolding for the workerd (vitest-pool-workers) suites: the env
 * record cast, the Inbox DO stub, and a recording mock for env.AI. Each
 * suite used to re-implement these; the mocks drifted apart as a result.
 */

export const envRecord = () => env as unknown as Record<string, unknown>;

export type RateLimitRow = {
  key: string;
  day: string;
  count: number;
};

/** The slice of the Inbox DO's RPC surface the tests use. */
export type InboxRpc = {
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  hitRateLimit(key: string, day: string): Promise<number>;
  rateLimitRows(): Promise<RateLimitRow[]>;
  guestbookList(): Promise<{ name: string; url?: string; at: string }[]>;
  guestbookRegister(
    ip: string,
    name: string,
    url?: string,
  ): Promise<{ created: boolean } | { error: string }>;
};

export const inboxStub = (): InboxRpc =>
  (env as unknown as { Inbox: DurableObjectNamespace }).Inbox.get(
    (env as unknown as { Inbox: DurableObjectNamespace }).Inbox.idFromName(
      "inbox",
    ),
  ) as unknown as InboxRpc;

export type AiMessage = {
  role: string;
  content?: unknown;
};

export type AiCall = {
  model: string;
  payload: {
    messages?: AiMessage[];
    tools?: { name?: string; function?: { name?: string } }[];
  };
};

/**
 * Installs a recording mock as env.AI. Every call is snapshotted into
 * `calls` (request shape is what suites assert on); `respond` produces the
 * result — canned replies should carry a MOCK_REPLY marker so round-trips
 * have a deterministic string to look for.
 */
export function installMockAI(
  respond: (payload: AiCall["payload"]) => unknown,
): { calls: AiCall[] } {
  const calls: AiCall[] = [];
  envRecord().AI = {
    run: async (model: string, payload: AiCall["payload"]) => {
      calls.push({ model, payload: JSON.parse(JSON.stringify(payload)) });
      return respond(payload);
    },
  };
  return { calls };
}
