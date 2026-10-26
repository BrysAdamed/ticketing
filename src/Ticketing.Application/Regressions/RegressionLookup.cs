using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Regressions;

namespace Ticketing.Application.Regressions;

/// <summary>A resolved, readable regression session and the caller's access to its project.</summary>
public sealed record RegressionTarget(Guid Id, Guid ProjectId, int Number, Guid StartedById, ProjectAccessGrant Grant)
{
    public string Key => HumanKeys.Regression(Grant.ProjectKey, Number);
}

/// <summary>
/// The single resolver for session references (key such as <c>WEB-R-3</c>, case-insensitive, or id) and for items inside
/// a session (test case key such as <c>WEB-TC-7</c>, item id or test case id). Unreadable projects give not found.
/// </summary>
public static class RegressionLookup
{
    public static async Task<RegressionTarget> ReadAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        IQueryable<RegressionSession> sessions;
        if (Guid.TryParse(keyOrId, out var id))
            sessions = db.RegressionSessions.Where(s => s.Id == id);
        else if (HumanKeys.TryParseRegression(keyOrId, out var projectKey, out var number))
            sessions = db.RegressionSessions.Where(s => s.Number == number && db.Projects.Any(p => p.Id == s.ProjectId && p.Key == projectKey));
        else
            throw NotFound(keyOrId);

        var row = await sessions.AsNoTracking()
                .Select(s => new { s.Id, s.ProjectId, s.Number, s.StartedById })
                .SingleOrDefaultAsync(cancellationToken)
            ?? throw NotFound(keyOrId);
        var grant = await access.FindAsync(row.ProjectId, cancellationToken) ?? throw NotFound(keyOrId);
        return new RegressionTarget(row.Id, row.ProjectId, row.Number, row.StartedById, grant);
    }

    /// <summary>Requires write access (Owner or Member, write-scoped credentials, project not archived).</summary>
    public static async Task<RegressionTarget> WriteAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var target = await ReadAsync(db, access, keyOrId, cancellationToken);
        return target with { Grant = await access.EnsureCanWriteAsync(target.ProjectId, cancellationToken) };
    }

    /// <summary>Resolves an item of <paramref name="session"/> by test case key, item id or test case id.</summary>
    public static async Task<Guid> ItemIdAsync(ITicketingDbContext db, RegressionTarget session, string reference, CancellationToken cancellationToken)
    {
        var sessionId = session.Id;
        var items = db.RegressionSessionItems.AsNoTracking().Where(i => i.SessionId == sessionId);
        if (Guid.TryParse(reference, out var id))
            items = items.Where(i => i.Id == id || i.TestCaseId == id);
        else if (HumanKeys.TryParseTestCase(reference, out var projectKey, out var number) && projectKey == session.Grant.ProjectKey)
        {
            var key = HumanKeys.TestCase(projectKey, number);
            items = items.Where(i => i.TestCaseKey == key);
        }
        else
            throw ItemNotFound(session, reference);

        return await items.Select(i => (Guid?)i.Id).FirstOrDefaultAsync(cancellationToken) ?? throw ItemNotFound(session, reference);
    }

    public static string Url(string projectKey, string sessionKey) => $"/projects/{projectKey}/regressions/{sessionKey}";

    public static string ItemUrl(string projectKey, string sessionKey, string testCaseKey) => $"{Url(projectKey, sessionKey)}?item={testCaseKey}";

    internal static AppException NotFound(string keyOrId) =>
        AppException.NotFound(RegressionErrors.NotFound, $"Regression session '{keyOrId.Trim()}' was not found.");

    private static AppException ItemNotFound(RegressionTarget session, string reference) =>
        AppException.NotFound(RegressionErrors.ItemNotFound, $"Test case '{reference.Trim()}' is not part of {session.Key}.");
}

/// <summary>
/// Serializes session-level changes against item changes: item writes hold a shared lock on the session row, completing
/// and cancelling take it exclusively, so no result lands on a session that has just been completed.
/// </summary>
internal static class RegressionLocks
{
    public static Task ShareAsync(ITicketingDbContext db, Guid sessionId, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlAsync($"SELECT 1 FROM regression_sessions WHERE id = {sessionId} FOR SHARE", cancellationToken);

    public static Task ExclusiveAsync(ITicketingDbContext db, Guid sessionId, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlAsync($"SELECT 1 FROM regression_sessions WHERE id = {sessionId} FOR UPDATE", cancellationToken);
}
