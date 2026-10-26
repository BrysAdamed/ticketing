using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Users;

/// <summary>
/// User search for pickers and the MCP <c>find_users</c> tool (spec 9.3). Matches an email prefix or the start of any word
/// of the display name. With a project, only active users who can write there: everyone on a public project, Admins and
/// Owner/Member members on a private one. An unreadable project is 404, as everywhere.
/// </summary>
public static class FindUsers
{
    public const int MaxResults = 20;

    public sealed record Query(string? Text = null, string? ProjectKeyOrId = null, bool IncludeInactive = false, int? Limit = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<UserLookupDto>>
    {
        public async Task<IReadOnlyList<UserLookupDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var users = db.Users.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(request.ProjectKeyOrId))
            {
                var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
                var projectId = grant.ProjectId;
                users = users.Where(u => u.IsActive);
                if (grant.Visibility == ProjectVisibility.Private)
                    users = users.Where(u => u.GlobalRole == GlobalRole.Admin
                        || db.ProjectMembers.Any(m => m.ProjectId == projectId && m.UserId == u.Id && m.Role != ProjectRole.Viewer));
            }
            else if (!request.IncludeInactive)
            {
                users = users.Where(u => u.IsActive);
            }

            var text = request.Text?.Trim();
            if (!string.IsNullOrEmpty(text))
            {
                var prefix = SqlLike.StartsWith(text);
                var wordPrefix = "% " + prefix;
                users = users.Where(u =>
                    EF.Functions.ILike(u.Email, prefix) || EF.Functions.ILike(u.DisplayName, prefix) || EF.Functions.ILike(u.DisplayName, wordPrefix));
            }

            return await users
                .OrderByDescending(u => u.IsActive)
                .ThenBy(u => u.DisplayName)
                .ThenBy(u => u.Email)
                .Take(Math.Clamp(request.Limit ?? MaxResults, 1, MaxResults))
                .Select(u => new UserLookupDto(u.Id, u.Email, u.DisplayName, u.IsActive))
                .ToListAsync(cancellationToken);
        }
    }
}
