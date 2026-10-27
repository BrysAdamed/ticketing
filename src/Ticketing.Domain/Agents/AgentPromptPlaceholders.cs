using System.Collections.Frozen;
using System.Globalization;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Agents;

public sealed record AgentPromptPlaceholder(string Name, string Description);

/// <summary>
/// The placeholders an agent prompt may use (spec 13.4). Only values with a fixed format or written by Owners and Admins are
/// offered; ticket titles, descriptions and comments are deliberately absent, because anyone with edit rights could turn them
/// into instructions (D-98). The agent reads those over MCP instead.
/// </summary>
public static class AgentPromptPlaceholders
{
    public const string TicketKey = "ticket.key";
    public const string TicketType = "ticket.type";
    public const string TicketUrl = "ticket.url";
    public const string ProjectKey = "project.key";
    public const string RepositoryUrl = "project.repositoryUrl";
    public const string InstanceUrl = "instance.url";
    public const string Finish = "finish";
    public const string TemplateId = "template.id";

    public static readonly IReadOnlyList<AgentPromptPlaceholder> All =
    [
        new(TicketKey, "The ticket key, for example TKT-42."),
        new(TicketType, "The ticket type: Epic, UserStory, Technical, Spike or Bug."),
        new(TicketUrl, "The ticket's absolute URL on this instance."),
        new(ProjectKey, "The project key, for example TKT."),
        new(RepositoryUrl, "The project's repository URL; empty when not set."),
        new(InstanceUrl, "This instance's public URL."),
        new(Finish, "The finish step for the project's merge policy: stop at Review, or merge to main once verified."),
        new(TemplateId, "Which prompt ran, for example 'Bug v3 / C' (D = instance default, C = project custom)."),
    ];

    public static readonly IReadOnlySet<string> Names = All.Select(p => p.Name).ToFrozenSet(StringComparer.Ordinal);
}

/// <summary>The trusted values a prompt is rendered with.</summary>
public sealed record AgentPromptContext(
    string TicketKey,
    TicketType TicketType,
    string? TicketUrl,
    string ProjectKey,
    string? RepositoryUrl,
    string? InstanceUrl,
    string Finish,
    string TemplateId)
{
    public IReadOnlyDictionary<string, string?> Values() => new Dictionary<string, string?>(StringComparer.Ordinal)
    {
        [AgentPromptPlaceholders.TicketKey] = TicketKey,
        [AgentPromptPlaceholders.TicketType] = TicketType.ToString(),
        [AgentPromptPlaceholders.TicketUrl] = TicketUrl,
        [AgentPromptPlaceholders.ProjectKey] = ProjectKey,
        [AgentPromptPlaceholders.RepositoryUrl] = RepositoryUrl,
        [AgentPromptPlaceholders.InstanceUrl] = InstanceUrl,
        [AgentPromptPlaceholders.Finish] = Finish,
        [AgentPromptPlaceholders.TemplateId] = TemplateId,
    };

    /// <summary><c>Bug v3 / C</c>: the type, the template version and its source (D = instance default, C = project custom).</summary>
    public static string TemplateIdFor(TicketType type, int version, AgentPromptSource source) =>
        string.Create(CultureInfo.InvariantCulture, $"{type} v{version} / {(source == AgentPromptSource.Custom ? 'C' : 'D')}");
}
