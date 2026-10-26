using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Ticketing.Domain.FeatureFlags;

/// <summary>
/// Deterministic rollout bucket shared with the TypeScript client (spec 6.13): the first 4 bytes of
/// SHA-256(UTF-8 "{flagKey}:{userId}") as an unsigned big-endian integer, mod 100. The user id is the lower-case "D" GUID format.
/// Test vectors: docs/architecture/flag-bucketing-vectors.json.
/// </summary>
public static class FlagBucket
{
    public static int Compute(string flagKey, Guid userId)
    {
        Span<byte> hash = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(Encoding.UTF8.GetBytes($"{flagKey}:{userId:D}"), hash);
        return (int)(BinaryPrimitives.ReadUInt32BigEndian(hash) % 100);
    }
}

public static class FlagVariants
{
    public const string On = "on";
    public const string Off = "off";
}
