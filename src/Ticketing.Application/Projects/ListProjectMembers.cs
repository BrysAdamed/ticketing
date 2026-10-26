using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.Projects;

public static class ListProjectMembers
{
    public sealed record Query(string ProjectKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<ProjectMemberDto>>
    {
        public async Task<IReadOnlyList<ProjectMemberDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            return await ProjectMembership.LoadMembersAsync(db, grant.ProjectId, grant.Visibility, cancellationToken);
        }
    }
}
