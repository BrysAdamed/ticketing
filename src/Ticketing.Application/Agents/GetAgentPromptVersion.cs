using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Users;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>One version of a template slot with its body.</summary>
public static class GetAgentPromptVersion
{
    public sealed record Query(string? ProjectKeyOrId, string Slot, int Number);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents) : IHandler<Query, AgentPromptVersionDto>
    {
        public async Task<AgentPromptVersionDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await agents.ReadAsync(request.ProjectKeyOrId, request.Slot, cancellationToken);
            var number = request.Number;
            return await db.AgentPromptTemplateVersions
                .AsNoTracking()
                .Where(v => v.Number == number && AgentPromptQueries.For(db, target).Any(t => t.Id == v.TemplateId))
                .Select(v => new AgentPromptVersionDto(
                    v.Number,
                    v.Mode,
                    v.Body,
                    v.BuiltInVersion,
                    v.ChangeNote,
                    db.Users.Where(u => u.Id == v.AuthorId).Select(u => new UserLookupDto(u.Id, u.Email, u.DisplayName, u.IsActive)).FirstOrDefault(),
                    v.CreatedAt,
                    v.RestoredFrom))
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw VersionNotFound(target, number);
        }
    }

    internal static AppException VersionNotFound(AgentPromptTarget target, int number) =>
        AppException.NotFound(AgentErrors.VersionNotFound, $"Version {number} of the {target.Slot.Name} prompt was not found.");
}
