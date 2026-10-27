using System.Collections.Frozen;
using System.Reflection;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using Ticketing.Application.FeatureFlags;

namespace Ticketing.Api.Mcp;

/// <summary>
/// Lists the marked tool in <c>tools/list</c> only while <see cref="GateType"/> (an <see cref="IFeatureGate"/>) is open for
/// the token's user. The tool's handler must still check the gate itself, so a direct call reports the feature's own error.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class FeatureGateAttribute(Type gateType) : Attribute
{
    public Type GateType { get; } = gateType;
}

internal static class FeatureGatedTools
{
    private static readonly FrozenDictionary<string, Type> Gates = typeof(FeatureGatedTools).Assembly
        .GetTypes()
        .Where(t => t.GetCustomAttribute<McpServerToolTypeAttribute>() is not null)
        .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance))
        .Select(m => (Tool: m.GetCustomAttribute<McpServerToolAttribute>(), Gate: m.GetCustomAttribute<FeatureGateAttribute>()))
        .Where(m => m.Tool?.Name is not null && m.Gate is not null)
        .ToFrozenDictionary(m => m.Tool!.Name!, m => m.Gate!.GateType, StringComparer.Ordinal);

    public static async Task<ListToolsResult> FilterAsync(ListToolsResult result, IServiceProvider services, CancellationToken cancellationToken)
    {
        var closed = new HashSet<Type>();
        foreach (var gateType in result.Tools.Select(t => Gates.GetValueOrDefault(t.Name)).OfType<Type>().Distinct())
        {
            if (!await ((IFeatureGate)services.GetRequiredService(gateType)).IsEnabledAsync(cancellationToken))
                closed.Add(gateType);
        }
        if (closed.Count > 0)
            result.Tools = [.. result.Tools.Where(t => !Gates.TryGetValue(t.Name, out var gate) || !closed.Contains(gate))];
        return result;
    }
}
