/// Percentage-rollout bucket, identical to the server's C# implementation (spec 6.13):
/// first 4 bytes of SHA-256(UTF-8 "{flagKey}:{userId}") as an unsigned big-endian integer,
/// mod 100. `userId` is the lower-case hyphenated UUID. Shared test vectors live in
/// docs/architecture/flag-bucketing-vectors.json.
export async function flagBucket(flagKey: string, userId: string): Promise<number> {
  const bytes = new TextEncoder().encode(`${flagKey}:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new DataView(digest).getUint32(0, false) % 100;
}

export async function isInRollout(
  flagKey: string,
  userId: string,
  rolloutPercentage: number,
): Promise<boolean> {
  return (await flagBucket(flagKey, userId)) < rolloutPercentage;
}
