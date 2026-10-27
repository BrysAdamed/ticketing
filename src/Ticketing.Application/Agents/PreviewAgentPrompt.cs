using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Agents;

/// <summary>
/// Renders a template as the editor shows it, storing nothing. <c>body</c> is the text being edited; null previews what is
/// stored (for a project type: the instance default, which is what "Use default" produces). A type slot renders with the
/// current guardrails; the guardrails slot renders after the default of the sample ticket's type. <c>ticketKey</c> picks a
/// real ticket (in the project, for a project slot); otherwise a synthetic one is used. Template and length problems come
/// back in <c>errors</c> with their line and column instead of failing the request.
/// </summary>
public static class PreviewAgentPrompt
{
    public sealed record Command
    {
        [JsonIgnore]
        public string? ProjectKeyOrId { get; init; }

        [JsonIgnore]
        public string Slot { get; init; } = string.Empty;

        public string? Body { get; init; }

        public string? TicketKey { get; init; }
    }

    public sealed class Handler(
        ITicketingDbContext db, AgentPromptAccess agents, IProjectAccess access, AgentPromptComposer composer, ICurrentUser currentUser)
        : IHandler<Command, AgentPromptPreviewDto>
    {
        public async Task<AgentPromptPreviewDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await agents.ReadAsync(command.ProjectKeyOrId, command.Slot, cancellationToken);
            currentUser.EnsureCookieSession();
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);
            var (project, number, ticketType) = await SubjectAsync(command, target, cancellationToken);

            var body = string.IsNullOrWhiteSpace(command.Body) ? null : command.Body;
            if (body is not null && body.Length > AgentPromptTemplate.BodyMaxLength)
                return Failed(project, number, new AgentPromptIssueDto(
                    AgentErrors.TemplateTooLong,
                    string.Create(CultureInfo.InvariantCulture, $"The template must be at most {AgentPromptTemplate.BodyMaxLength} characters."),
                    null,
                    null));

            var guardrails = instance[AgentPromptSlot.Guardrails];
            string? typeBody;
            string templateId;
            string? guardrailsBody = guardrails.Body;
            if (target.Slot.IsGuardrails)
            {
                var defaults = instance[new AgentPromptSlot(ticketType)];
                typeBody = defaults.Body;
                templateId = AgentPromptContext.TemplateIdFor(ticketType, defaults.CurrentVersion, AgentPromptSource.Default);
                guardrailsBody = body ?? guardrails.Body;
            }
            else if (target.Project is not null && body is not null)
            {
                var current = await AgentPromptQueries.For(db, target).Select(t => (int?)t.CurrentVersion).SingleOrDefaultAsync(cancellationToken) ?? 0;
                typeBody = body;
                templateId = AgentPromptContext.TemplateIdFor(target.Type, current + 1, AgentPromptSource.Custom);
            }
            else
            {
                var defaults = instance[target.Slot];
                typeBody = body ?? defaults.Body;
                templateId = AgentPromptContext.TemplateIdFor(target.Type, defaults.CurrentVersion + (body is null ? 0 : 1), AgentPromptSource.Default);
            }

            var rendering = composer.TryCompose(typeBody, guardrailsBody, composer.Context(project, number, ticketType, templateId));
            return new AgentPromptPreviewDto(
                rendering.Prompt, rendering.Prompt?.Length ?? 0, AgentPrompt.LengthLimit, HumanKeys.Ticket(project.Key, number), rendering.Errors,
                rendering.GuardrailsStart);
        }

        private async Task<(AgentPromptProject Project, int Number, TicketType Type)> SubjectAsync(
            Command command, AgentPromptTarget target, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(command.TicketKey))
            {
                var project = target.Project is { } grant
                    ? await AgentPromptWrites.ProjectAsync(db, grant.ProjectId, cancellationToken)
                    : AgentPromptComposer.SampleProject;
                return (project, AgentPromptComposer.SampleTicketNumber, AgentPromptWrites.SampleType(target.Slot));
            }

            var ticket = await TicketLookup.ReadAsync(db, access, command.TicketKey, cancellationToken);
            if (target.Project is { } scope && ticket.ProjectId != scope.ProjectId)
                throw TicketLookup.NotFound(command.TicketKey);
            var type = await db.Tickets.Where(t => t.Id == ticket.Id).Select(t => t.Type).SingleAsync(cancellationToken);
            return (await AgentPromptWrites.ProjectAsync(db, ticket.ProjectId, cancellationToken), ticket.Number, type);
        }

        private static AgentPromptPreviewDto Failed(AgentPromptProject project, int number, AgentPromptIssueDto issue) =>
            new(null, 0, AgentPrompt.LengthLimit, HumanKeys.Ticket(project.Key, number), [issue]);
    }
}
