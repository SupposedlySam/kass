/** Where Herga releases are published; the app checks here for updates. */
export const RELEASES_REPO = 'mrgnhnt96/herga';

export interface Release {
  /** The version without the tag's leading `v`, e.g. `0.6.0`. */
  version: string;
  /** The release's page on GitHub, with the DMG to download. */
  url: string;
}

/** The latest published release, or `null` when there isn't one yet. */
export async function fetchLatestRelease(): Promise<Release | null> {
  const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release: { tag_name: string; html_url: string } = await response.json();
  return { version: release.tag_name.replace(/^v/, ''), url: release.html_url };
}

/**
 * Whether `latest` is a newer `major.minor.patch` than `current`. Anything
 * that isn't a plain version (a pre-release, a typo) never counts as newer.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (version: string) =>
    /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null;
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
