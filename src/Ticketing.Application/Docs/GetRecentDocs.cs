using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Docs;

/// <summary>The project's most recently updated pages and diagrams (Docs home, spec 1.15).</summary>
public static class GetRecentDocs
{
    public const int DefaultLimit = 10;
    public const int MaxLimit = 50;

    public sealed record Query(string ProjectKeyOrId, int? Limit = null) : IValidatable
    {
        public void Validate(Validator validator) => validator.Range("limit", Limit, 1, MaxLimit);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<DocSummaryDto>>
    {
        public async Task<IReadOnlyList<DocSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            return await DocQueries.RecentAsync(db, grant.ProjectId, grant.ProjectKey, request.Limit ?? DefaultLimit, cancellationToken);
        }
    }
}
