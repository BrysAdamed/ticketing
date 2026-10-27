using Microsoft.Extensions.Options;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>The project facts a prompt is rendered with.</summary>
public sealed record AgentPromptProject(string Key, string? RepositoryUrl, AgentMergePolicy MergePolicy);

/// <summary>A rendered prompt, or the template and length errors that prevented it.</summary>
public sealed record AgentPromptRendering(string? Prompt, IReadOnlyList<AgentPromptIssueDto> Errors)
{
    public bool Succeeded => Prompt is not null && Errors.Count == 0;
}

/// <summary>
/// Builds the trusted placeholder values and renders a type template followed by the guardrails (spec 13.4, 13.5). The one
/// renderer used by resolution, previews and the save-time length check, so nothing has to be kept in sync elsewhere.
/// </summary>
public sealed class AgentPromptComposer(IBuiltInAgentPrompts builtIns, IOptions<AgentOptions> options)
{
    /// <summary>The number of the synthetic ticket that previews and save-time checks render with when no ticket is chosen.</summary>
    public const int SampleTicketNumber = 1234;

    /// <summary>Project facts for instance-default previews and checks: a typical key and repository URL.</summary>
    public static readonly AgentPromptProject SampleProject = new("PROJECT", "https://git.example.com/team/project.git", AgentMergePolicy.Review);

    public AgentPromptContext Context(AgentPromptProject project, int ticketNumber, TicketType type, int templateVersion, AgentPromptSource source) =>
        Context(project, ticketNumber, type, AgentPromptContext.TemplateIdFor(type, templateVersion, source));

    /// <param name="templateId">The <c>{{template.id}}</c> value, see <see cref="AgentPromptContext.TemplateIdFor"/>.</param>
    public AgentPromptContext Context(AgentPromptProject project, int ticketNumber, TicketType type, string templateId)
    {
        var key = HumanKeys.Ticket(project.Key, ticketNumber);
        var instanceUrl = options.Value.InstanceUrl;
        return new AgentPromptContext(
            key,
            type,
            instanceUrl is null ? null : $"{instanceUrl}/tickets/{key}",
            project.Key,
            project.RepositoryUrl,
            instanceUrl,
            builtIns.FinishSentence(project.MergePolicy),
            templateId);
    }

    /// <summary>Renders the type template and the guardrails; throws a validation error on template syntax.</summary>
    public string Compose(string typeTemplate, string? guardrails, AgentPromptContext context) =>
        AgentPrompt.Compose(Render(typeTemplate, context), guardrails is null ? null : Render(guardrails, context));

    /// <summary>Like <see cref="Compose"/>, but reports template errors and the length limit as issues instead of throwing.</summary>
    public AgentPromptRendering TryCompose(string? typeTemplate, string? guardrails, AgentPromptContext context)
    {
        var errors = new List<AgentPromptIssueDto>();
        var type = TryRender(typeTemplate, context, errors);
        var rules = TryRender(guardrails, context, errors);
        if (errors.Count > 0)
            return new AgentPromptRendering(null, errors);

        var prompt = AgentPrompt.Compose(type ?? string.Empty, rules);
        if (!AgentPrompt.FitsLimit(prompt))
            errors.Add(new AgentPromptIssueDto(AgentErrors.PromptTooLong, AgentPrompt.TooLongMessage(prompt.Length), null, null));
        return new AgentPromptRendering(prompt, errors);
    }

    private static string Render(string body, AgentPromptContext context) =>
        PromptTemplate.Parse(body, AgentPromptPlaceholders.Names).EnsureValid("body").Render(context.Values());

    private static string? TryRender(string? body, AgentPromptContext context, List<AgentPromptIssueDto> errors)
    {
        if (string.IsNullOrWhiteSpace(body))
            return null;
        var parsed = PromptTemplate.Parse(body, AgentPromptPlaceholders.Names);
        if (parsed.Template is null)
        {
            errors.AddRange(parsed.Errors.Select(e => new AgentPromptIssueDto(e.Code, e.Message, e.Line, e.Column)));
            return null;
        }
        return parsed.Template.Render(context.Values());
    }
}
