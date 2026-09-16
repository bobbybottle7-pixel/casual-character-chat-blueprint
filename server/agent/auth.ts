import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type AuthKind = 'subscription' | 'api-key' | 'host-managed' | 'unknown';

export interface AuthStatus {
  kind: AuthKind;
  detail: string;
  /** Human-readable next step, set only when `kind` is 'unknown'. */
  fix?: string;
}

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

/** macOS keeps Claude Code credentials in the login keychain, not on disk. */
function hasKeychainCredentials(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Work out which credentials the Agent SDK will end up using.
 *
 * The SDK spawns a bundled Claude Code binary, which resolves credentials the
 * same way the `claude` CLI does. So if you are logged into Claude Code on this
 * machine, Cam Claude runs on your subscription and no API key is involved.
 *
 * This mirrors that resolution order rather than making a live request, so
 * startup costs nothing. It is a best-effort read: the authoritative answer is
 * whether the first query succeeds.
 */
export function detectAuth(): AuthStatus {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { kind: 'api-key', detail: 'ANTHROPIC_API_KEY (metered, billed per token)' };
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return { kind: 'subscription', detail: 'CLAUDE_CODE_OAUTH_TOKEN' };
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return { kind: 'api-key', detail: 'ANTHROPIC_AUTH_TOKEN' };
  }

  // Claude Code on the web and other managed runners supply credentials through
  // the host rather than a file or key we can see.
  if (process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST?.trim()) {
    return { kind: 'host-managed', detail: 'credentials supplied by the host environment' };
  }

  for (const provider of [
    ['CLAUDE_CODE_USE_BEDROCK', 'Amazon Bedrock'],
    ['CLAUDE_CODE_USE_VERTEX', "Google Cloud's Agent Platform"],
    ['CLAUDE_CODE_USE_FOUNDRY', 'Microsoft Foundry'],
  ] as const) {
    if (process.env[provider[0]]?.trim()) {
      return { kind: 'api-key', detail: provider[1] };
    }
  }

  const credentialsFile = join(claudeConfigDir(), '.credentials.json');
  if (existsSync(credentialsFile)) {
    return { kind: 'subscription', detail: `Claude Code login (${credentialsFile})` };
  }

  if (hasKeychainCredentials()) {
    return { kind: 'subscription', detail: 'Claude Code login (macOS keychain)' };
  }

  return {
    kind: 'unknown',
    detail: 'none found in the places this probe looks',
    fix: 'If messages fail, run `claude login` to use your Claude subscription, or set ANTHROPIC_API_KEY to bill per token.',
  };
}

export function describeAuth(status: AuthStatus): string {
  switch (status.kind) {
    case 'subscription':
      return `auth: subscription — ${status.detail}`;
    case 'api-key':
      return `auth: api key — ${status.detail}`;
    case 'host-managed':
      return `auth: host-managed — ${status.detail}`;
    case 'unknown':
      // The probe reads the usual credential locations; it does not make a live
      // request. A managed or unusual setup can authenticate fine from here.
      return `auth: not detected — ${status.detail}`;
  }
}
