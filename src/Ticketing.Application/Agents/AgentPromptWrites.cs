using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>What every template write shares: the length check against the guardrails, the activity entry and the save.</summary>
internal static class AgentPromptWrites
{
    public static async Task<AgentPromptProject> ProjectAsync(ITicketingDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        await db.Projects
            .AsNoTracking()
            .Where(p => p.Id == projectId)
            .Select(p => new AgentPromptProject(p.Key, p.RepositoryUrl, p.AgentMergePolicy))
            .SingleAsync(cancellationToken);

    /// <summary>
    /// A project's custom template, rendered for a sample ticket of the project and followed by the current guardrails, must
    /// stay below the limit.
    /// </summary>
    public static async Task EnsureProjectFitsAsync(
        ITicketingDbContext db, AgentPromptComposer composer, AgentPromptTemplate template, AgentPromptTemplate guardrails, CancellationToken cancellationToken)
    {
        if (template.Mode != AgentPromptMode.Custom || template.Body is null || template.ProjectId is not { } projectId)
            return;
        var project = await ProjectAsync(db, projectId, cancellationToken);
        var context = composer.Context(project, AgentPromptComposer.SampleTicketNumber, template.TicketType!.Value, template.CurrentVersion, AgentPromptSource.Custom);
        AgentPrompt.EnsureFitsLimit(composer.Compose(template.Body, guardrails.Body, context), "body");
    }

    /// <summary>
    /// After an instance slot changed: a type default must fit with the guardrails, and new guardrails must fit with every
    /// type default. Rendered for <see cref="AgentPromptComposer.SampleProject"/>; project overrides are checked again when
    /// a prompt is resolved.
    /// </summary>
    public static void EnsureInstanceFits(
        AgentPromptComposer composer, AgentPromptTemplate changed, IReadOnlyDictionary<AgentPromptSlot, AgentPromptTemplate> instance)
    {
        var guardrails = changed.Slot.IsGuardrails ? changed.Body : instance[AgentPromptSlot.Guardrails].Body;
        var types = changed.Slot.IsGuardrails ? AgentPromptSlot.TicketTypes : [changed.Slot];
        foreach (var slot in types)
        {
            var template = slot == changed.Slot ? changed : instance[slot];
            var context = composer.Context(
                AgentPromptComposer.SampleProject, AgentPromptComposer.SampleTicketNumber, slot.Type!.Value, template.CurrentVersion, AgentPromptSource.Default);
            var prompt = composer.Compose(template.Body ?? string.Empty, guardrails, context);
            if (AgentPrompt.FitsLimit(prompt))
                continue;
            var message = $"{AgentPrompt.TooLongMessage(prompt.Length)} ({slot.Name} default)";
            throw new AppException(
                ErrorKind.Validation, AgentErrors.PromptTooLong, message, "Shorten the template or the guardrails.",
                new Dictionary<string, string[]> { ["body"] = [message] });
        }
    }

    public static void RecordUpdated(IActivityLog activity, AgentPromptTemplate template, int previousVersion, AgentPromptMode previousMode) =>
        activity.RecordChange(
            ActivityEntityType.AgentPrompt,
            template.Id,
            template.ProjectId,
            AgentPromptDefaults.UpdatedAction,
            template.Slot.Name,
            AgentPromptDefaults.ActivityValue(previousVersion, previousMode),
            AgentPromptDefaults.ActivityValue(template.CurrentVersion, template.Mode));

    /// <summary>Saves; a concurrent writer (row version or a duplicate first save) becomes <c>agent.prompt.versionConflict</c>.</summary>
    public static async Task SaveAsync(ITicketingDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || ex.IsUniqueViolation())
        {
            throw AppException.Conflict(AgentErrors.VersionConflict, "The prompt was changed by someone else.", "Reload the prompt and apply your change again.");
        }
    }

    public static TicketType SampleType(AgentPromptSlot slot) => slot.Type ?? TicketType.UserStory;
}
