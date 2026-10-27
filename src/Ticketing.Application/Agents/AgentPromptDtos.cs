using Ticketing.Application.Users;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>A template or length problem; <see cref="Line"/> and <see cref="Column"/> (1-based) are set for template syntax errors.</summary>
public sealed record AgentPromptIssueDto(string Code, string Message, int? Line, int? Column);

/// <summary>
/// A project's handling of one ticket type. <see cref="Version"/> is the project row's version (0 while it never left
/// Inherit); send it back as <c>baseVersion</c> when saving. <see cref="DefaultChanged"/> is true for a Custom row written
/// against an older instance default.
/// </summary>
public sealed record ProjectAgentPromptSummaryDto(
    TicketType Type,
    AgentPromptMode Mode,
    int Version,
    AgentPromptSource? EffectiveSource,
    int? EffectiveVersion,
    int DefaultVersion,
    bool DefaultChanged,
    UserLookupDto? UpdatedBy,
    DateTimeOffset? UpdatedAt);

/// <summary>A project slot with its own body, the effective body (null when Off), the instance default and the guardrails.</summary>
public sealed record ProjectAgentPromptDto(
    TicketType Type,
    AgentPromptMode Mode,
    int Version,
    string? Body,
    AgentPromptSource? EffectiveSource,
    int? EffectiveVersion,
    string? EffectiveBody,
    int DefaultVersion,
    string DefaultBody,
    int? BasedOnDefaultVersion,
    bool DefaultChanged,
    int GuardrailsVersion,
    string? Guardrails,
    UserLookupDto? UpdatedBy,
    DateTimeOffset? UpdatedAt);

/// <summary>
/// An instance slot (a ticket type or <c>Guardrails</c>). <see cref="FollowsBuiltIn"/> rows upgrade automatically;
/// <see cref="NewerBuiltInAvailable"/> is true for edited rows when a newer built-in shipped after the one they were based on.
/// </summary>
public sealed record InstanceAgentPromptSummaryDto(
    string Slot,
    TicketType? Type,
    int Version,
    string? BuiltInVersion,
    bool FollowsBuiltIn,
    string LatestBuiltInVersion,
    bool NewerBuiltInAvailable,
    int OverridingProjects,
    UserLookupDto? UpdatedBy,
    DateTimeOffset UpdatedAt);

public sealed record InstanceAgentPromptDto(
    string Slot,
    TicketType? Type,
    int Version,
    string? Body,
    string? BuiltInVersion,
    bool FollowsBuiltIn,
    string LatestBuiltInVersion,
    bool NewerBuiltInAvailable,
    string BuiltInBody,
    int OverridingProjects,
    UserLookupDto? UpdatedBy,
    DateTimeOffset UpdatedAt);

public sealed record AgentPromptVersionSummaryDto(
    int Number,
    AgentPromptMode Mode,
    string? BuiltInVersion,
    string? ChangeNote,
    UserLookupDto? Author,
    DateTimeOffset CreatedAt,
    int? RestoredFrom);

public sealed record AgentPromptVersionDto(
    int Number,
    AgentPromptMode Mode,
    string? Body,
    string? BuiltInVersion,
    string? ChangeNote,
    UserLookupDto? Author,
    DateTimeOffset CreatedAt,
    int? RestoredFrom);

/// <summary>A rendered preview (nothing is stored). <see cref="Prompt"/> is null when the template has errors.</summary>
public sealed record AgentPromptPreviewDto(string? Prompt, int Length, int LengthLimit, string TicketKey, IReadOnlyList<AgentPromptIssueDto> Errors);

/// <summary>Which template a resolved prompt used.</summary>
public sealed record AgentPromptTemplateRefDto(AgentPromptSource Source, int Version, DateTimeOffset UpdatedAt, UserLookupDto? UpdatedBy);

/// <summary>Ticket text written by someone outside a public project, which the agent will read over MCP (D-100).</summary>
public sealed record AgentPromptOutsiderContentDto(AgentPromptContentSource Source, UserLookupDto? Author, DateTimeOffset At);

/// <summary>
/// The prompt for a ticket after resolution (spec 13.5), with the template and guardrails versions it was built from.
/// <see cref="OutsiderContent"/> is set on public projects when the latest description write or comment came from a
/// non-member, so clients can warn before launching.
/// </summary>
public sealed record ResolvedAgentPromptDto(
    string Prompt, string TicketKey, TicketType TicketType, AgentPromptTemplateRefDto Template, int GuardrailsVersion, AgentPromptOutsiderContentDto? OutsiderContent);
