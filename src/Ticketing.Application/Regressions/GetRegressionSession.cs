using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

/// <summary>
/// A session by key (<c>WEB-R-3</c>) or id with its summary and items in snapshot order, optionally filtered by item
/// status and assignee (<c>me</c>, <c>unassigned</c>, an email or an id). The summary always covers the whole session.
/// </summary>
public static class GetRegressionSession
{
    public sealed record Query(string KeyOrId, IReadOnlyList<RegressionItemStatus>? ItemStatuses = null, string? Assignee = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, RegressionSessionDto>
    {
        public async Task<RegressionSessionDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await RegressionLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var filter = new RegressionQueries.ItemFilter(request.ItemStatuses);
            if (!string.IsNullOrWhiteSpace(request.Assignee))
                filter = filter with { FilterByAssignee = true, AssigneeId = await RegressionUsers.FilterAsync(db, currentUser, request.Assignee, cancellationToken) };
            return await RegressionQueries.LoadAsync(db, currentUser, target, filter, cancellationToken);
        }
    }
}
