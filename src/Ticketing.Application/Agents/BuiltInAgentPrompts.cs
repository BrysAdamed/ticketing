using System.Collections.Frozen;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>The shipped default prompts (spec 13.3), one release for all slots. Replaceable so tests can ship a second release.</summary>
public interface IBuiltInAgentPrompts
{
    /// <summary>The built-in release, for example <c>2026.10.1</c>; bump it whenever a text changes.</summary>
    string Version { get; }

    BuiltInPrompt For(AgentPromptSlot slot);

    /// <summary>The fixed template <c>{{finish}}</c> renders to for a merge policy; it may use every placeholder except <c>finish</c>.</summary>
    string FinishSentence(AgentMergePolicy policy);
}

/// <summary>Built-ins embedded from <c>Agents/BuiltIns/*.txt</c>.</summary>
internal sealed class EmbeddedAgentPrompts : IBuiltInAgentPrompts
{
    public const string Release = "2026.10.2";

    private static readonly Lazy<FrozenDictionary<string, string>> Texts = new(Load);

    public string Version => Release;

    public BuiltInPrompt For(AgentPromptSlot slot) => new(slot, Release, Texts.Value[FileName(slot)]);

    public string FinishSentence(AgentMergePolicy policy) =>
        Texts.Value[policy == AgentMergePolicy.MergeWhenVerified ? "finish-merge" : "finish-review"];

    private static string FileName(AgentPromptSlot slot) => slot.Type switch
    {
        null => "guardrails",
        TicketType.Epic => "epic",
        TicketType.UserStory => "user-story",
        TicketType.Technical => "technical",
        TicketType.Spike => "spike",
        TicketType.Bug => "bug",
        _ => throw new ArgumentOutOfRangeException(nameof(slot), slot, "Unknown ticket type."),
    };

    private static FrozenDictionary<string, string> Load()
    {
        const string prefix = "Ticketing.Application.Agents.BuiltIns.";
        var assembly = typeof(EmbeddedAgentPrompts).Assembly;
        var texts = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith(prefix, StringComparison.Ordinal)))
        {
            using var stream = assembly.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream);
            texts[Path.GetFileNameWithoutExtension(name[prefix.Length..])] = reader.ReadToEnd().Replace("\r\n", "\n", StringComparison.Ordinal).Trim();
        }
        return texts.ToFrozenDictionary(StringComparer.Ordinal);
    }
}
