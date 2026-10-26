using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.TestCases;

/// <summary>A test case by key (<c>WEB-TC-7</c>) or id, with its linked ticket and its latest runs in regression sessions.</summary>
public static class GetTestCase
{
    public sealed record Query(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, TestCaseDto>
    {
        public async Task<TestCaseDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TestCaseLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            return await TestCaseQueries.LoadAsync(db, currentUser, target, cancellationToken);
        }
    }
}
