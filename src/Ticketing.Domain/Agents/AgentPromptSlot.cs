using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Agents;

/// <summary>A template slot: a ticket type, or the guardrails block (instance only) when <see cref="Type"/> is null.</summary>
public readonly record struct AgentPromptSlot(TicketType? Type)
{
    public const string GuardrailsName = "Guardrails";

    public static readonly AgentPromptSlot Guardrails = new(null);

    public static readonly IReadOnlyList<AgentPromptSlot> TicketTypes = [.. Enum.GetValues<TicketType>().Select(t => new AgentPromptSlot(t))];

    /// <summary>The six instance slots: the five ticket types, then the guardrails.</summary>
    public static readonly IReadOnlyList<AgentPromptSlot> Instance = [.. TicketTypes, Guardrails];

    public bool IsGuardrails => Type is null;

    public string Name => Type?.ToString() ?? GuardrailsName;

    /// <summary>Parses a ticket type name or <c>guardrails</c>, ignoring case; numbers are not accepted.</summary>
    public static bool TryParse(string? value, out AgentPromptSlot slot)
    {
        slot = default;
        var name = value?.Trim();
        if (string.IsNullOrEmpty(name))
            return false;
        if (string.Equals(name, GuardrailsName, StringComparison.OrdinalIgnoreCase))
        {
            slot = Guardrails;
            return true;
        }
        foreach (var type in Enum.GetValues<TicketType>())
        {
            if (!string.Equals(type.ToString(), name, StringComparison.OrdinalIgnoreCase))
                continue;
            slot = new AgentPromptSlot(type);
            return true;
        }
        return false;
    }

    public override string ToString() => Name;
}
