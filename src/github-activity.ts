export interface GithubEvent {
  type?: string;
  repo?: { name?: string };
  payload?: Record<string, unknown>;
  created_at?: string;
}

const MAX_ITEMS = 30;
const MAX_LENGTH = 2048;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_SUMMARY = 120;

// GitHub event text is attacker-influenced; keep printable characters and
// basic whitespace only so a summary cannot smuggle extra lines or terminal
// escapes into the agent's system prompt.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0a-\x1f\x7f]/g;

function sanitize(text: string): string {
  const clean = text.replace(CONTROL_CHARS, "");
  return clean.length > MAX_SUMMARY
    ? `${clean.slice(0, MAX_SUMMARY - 1)}…`
    : clean;
}

function summarize(event: GithubEvent): string | null {
  const raw = rawSummary(event);
  return raw === null ? null : sanitize(raw);
}

function rawSummary(event: GithubEvent): string | null {
  const payload = event.payload ?? {};
  switch (event.type) {
    case "PushEvent": {
      const commits = payload.commits;
      if (!Array.isArray(commits) || commits.length === 0) return "pushed commits";
      const first = commits[0] as { message?: unknown };
      const message =
        typeof first?.message === "string" ? first.message.split("\n")[0] : "";
      return message ? `pushed: ${message}` : "pushed commits";
    }
    case "ReleaseEvent": {
      const release = payload.release as { tag_name?: unknown } | undefined;
      const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
      return tag ? `released ${tag}` : "published a release";
    }
    case "CreateEvent": {
      const refType = typeof payload.ref_type === "string" ? payload.ref_type : "";
      const ref = typeof payload.ref === "string" ? payload.ref : "";
      if (!refType) return null;
      return ref ? `created ${refType} ${ref}` : `created ${refType}`;
    }
    case "PullRequestEvent": {
      const pr = payload.pull_request as
        | { title?: unknown; merged?: unknown }
        | undefined;
      if (payload.action !== "closed" || pr?.merged !== true) return null;
      const title = typeof pr.title === "string" ? pr.title : "";
      return title ? `merged PR: ${title}` : "merged a pull request";
    }
    default:
      return null;
  }
}

export function shapeDigest(events: GithubEvent[]): string {
  const cutoff = Date.now() - MAX_AGE_MS;
  const lines: string[] = [];
  let length = 0;
  for (const event of events ?? []) {
    if (lines.length >= MAX_ITEMS) break;
    const created = Date.parse(event.created_at ?? "");
    if (!Number.isFinite(created) || created < cutoff) continue;
    const summary = summarize(event);
    if (!summary) continue;
    const repo = event.repo?.name ?? "unknown";
    const line = `- ${repo} ${event.created_at!.slice(0, 10)}: ${summary}`;
    if (length + line.length + 1 > MAX_LENGTH) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.length > 0 ? lines.join("\n") : "No recent activity.";
}
