/**
 * Reads a deployment flag from the environment, tolerantly.
 *
 * Docker's `--env-file` does NOT strip trailing comments: a line written as
 *
 *     AUTH_MODE=none                 # no login; set "oidc" later
 *
 * arrives in the container as the literal value
 * `none                 # no login; set "oidc" later`. A plain `=== "none"`
 * comparison then fails, the app silently takes the Supabase path, offers a
 * login it cannot serve, and reports a missing Supabase configuration — with
 * nothing in the message pointing at the real cause.
 *
 * Flags of this kind are short enum-like words that never contain whitespace,
 * so taking the first token is safe and turns a very confusing failure into a
 * working deployment. Values where a `#` or trailing space can be meaningful —
 * passwords, tokens, URLs — must NOT go through this and are read as-is.
 */
export function envFlag(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env[name];
  if (raw == null) return "";
  const value = String(raw).trim();
  const first = value.split(/\s/)[0] ?? "";
  if (first !== value) {
    // Worth saying out loud once: the deployment file is subtly wrong even
    // though the app now copes with it.
    console.warn(
      `[env] ${name} contains more than one word (${JSON.stringify(value)}). ` +
        `Using ${JSON.stringify(first)}. Docker's --env-file keeps trailing ` +
        `comments as part of the value — remove the comment from that line.`,
    );
  }
  return first;
}
