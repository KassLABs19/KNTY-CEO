/** Compare "1.2.3" style versions. Returns -1, 0 or 1. Pre-release tags are ignored. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** True when the app version is at or above the minimum the server accepts. */
export function isVersionSupported(appVersion: string, minimum: string): boolean {
  return compareVersions(appVersion, minimum) >= 0;
}
