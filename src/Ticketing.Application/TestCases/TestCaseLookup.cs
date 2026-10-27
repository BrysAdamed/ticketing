using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.TestCases;

namespace Ticketing.Application.TestCases;

/// <summary>A resolved, readable test case and the caller's access to its project.</summary>
public sealed record TestCaseTarget(Guid Id, Guid ProjectId, int Number, ProjectAccessGrant Grant)
{
    public string Key => HumanKeys.TestCase(Grant.ProjectKey, Number);
}

/// <summary>
/// The single resolver for user-supplied test case references: a key such as <c>WEB-TC-7</c> (case-insensitive) or an id.
/// Test cases in unreadable projects are reported as not found, never forbidden.
/// </summary>
public static class TestCaseLookup
{
    public static async Task<TestCaseTarget> ReadAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var row = await FindRowAsync(db, keyOrId, cancellationToken);
        var grant = await access.FindAsync(row.ProjectId, cancellationToken) ?? throw NotFound(keyOrId);
        return new TestCaseTarget(row.Id, row.ProjectId, row.Number, grant);
    }

    /// <summary>Requires write access (Owner or Member, write-scoped credentials, project not archived).</summary>
    public static async Task<TestCaseTarget> WriteAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var target = await ReadAsync(db, access, keyOrId, cancellationToken);
        return target with { Grant = await access.EnsureCanWriteAsync(target.ProjectId, cancellationToken) };
    }

    public static async Task<TestCaseTarget> OwnerAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var target = await ReadAsync(db, access, keyOrId, cancellationToken);
        return target with { Grant = await access.EnsureOwnerAsync(target.ProjectId, cancellationToken) };
    }

    public static string Url(string projectKey, string key) => $"/projects/{projectKey}/test-cases/{key}";

    internal static AppException NotFound(string keyOrId) =>
        AppException.NotFound(TestCaseErrors.NotFound, $"Test case '{keyOrId.Trim()}' was not found.");

    private static async Task<Row> FindRowAsync(ITicketingDbContext db, string keyOrId, CancellationToken cancellationToken)
    {
        IQueryable<TestCase> cases;
        if (Guid.TryParse(keyOrId, out var id))
            cases = db.TestCases.Where(c => c.Id == id);
        else if (HumanKeys.TryParseTestCase(keyOrId, out var projectKey, out var number))
            cases = db.TestCases.Where(c => c.Number == number && db.Projects.Any(p => p.Id == c.ProjectId && p.Key == projectKey));
        else
            throw NotFound(keyOrId);

        return await cases.AsNoTracking().Select(c => new Row(c.Id, c.ProjectId, c.Number)).SingleOrDefaultAsync(cancellationToken)
            ?? throw NotFound(keyOrId);
    }

    private sealed record Row(Guid Id, Guid ProjectId, int Number);
}
