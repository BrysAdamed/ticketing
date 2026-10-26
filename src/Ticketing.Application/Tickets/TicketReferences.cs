using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Tickets;

/// <summary>A resolved, readable, non-deleted ticket and the caller's access to its project.</summary>
public sealed record TicketTarget(Guid Id, Guid ProjectId, int Number, ProjectAccessGrant Grant)
{
    public string Key => HumanKeys.Ticket(Grant.ProjectKey, Number);
}

/// <summary>
/// The single resolver for user-supplied ticket references (key such as <c>WEB-42</c>, case-insensitive, or id). Tickets in
/// unreadable projects are reported as not found (never 403), deleted tickets as <c>ticket.deleted</c> naming who and when.
/// </summary>
public static class TicketLookup
{
    public static async Task<TicketTarget> ReadAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var (row, grant) = await FindAsync(db, access, keyOrId, cancellationToken);
        return new TicketTarget(row.Id, row.ProjectId, row.Number, grant);
    }

    /// <summary>Resolves the ticket and requires write access to its project (Owner or Member, write-scoped, not archived).</summary>
    public static async Task<TicketTarget> WriteAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var (row, _) = await FindAsync(db, access, keyOrId, cancellationToken);
        var grant = await access.EnsureCanWriteAsync(row.ProjectId, cancellationToken);
        return new TicketTarget(row.Id, row.ProjectId, row.Number, grant);
    }

    public static async Task<TicketTarget> OwnerAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var (row, _) = await FindAsync(db, access, keyOrId, cancellationToken);
        var grant = await access.EnsureOwnerAsync(row.ProjectId, cancellationToken);
        return new TicketTarget(row.Id, row.ProjectId, row.Number, grant);
    }

    /// <summary>Resolves a reference that must be in <paramref name="projectId"/> (for example a parent or a rank anchor).</summary>
    public static async Task<Guid> InProjectAsync(ITicketingDbContext db, Guid projectId, string projectKey, string keyOrId, CancellationToken cancellationToken)
    {
        var query = Rows(db, keyOrId) ?? throw NotFound(keyOrId);
        var row = await query.SingleOrDefaultAsync(cancellationToken);
        if (row is null || row.ProjectId != projectId)
            throw NotFound(keyOrId);
        if (row.DeletedAt is not null)
            throw Deleted(projectKey, row);
        return row.Id;
    }

    internal static AppException NotFound(string keyOrId) =>
        AppException.NotFound(TicketErrors.NotFound, $"Ticket '{keyOrId.Trim()}' was not found.");

    private static async Task<(Row Row, ProjectAccessGrant Grant)> FindAsync(
        ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var query = Rows(db, keyOrId) ?? throw NotFound(keyOrId);
        var row = await query.SingleOrDefaultAsync(cancellationToken) ?? throw NotFound(keyOrId);
        var grant = await access.FindAsync(row.ProjectId, cancellationToken) ?? throw NotFound(keyOrId);
        if (row.DeletedAt is not null)
            throw Deleted(grant.ProjectKey, row);
        return (row, grant);
    }

    private static IQueryable<Row>? Rows(ITicketingDbContext db, string keyOrId)
    {
        IQueryable<Ticket> tickets;
        if (Guid.TryParse(keyOrId, out var id))
        {
            tickets = db.Tickets.Where(t => t.Id == id);
        }
        else if (HumanKeys.TryParseTicket(keyOrId, out var projectKey, out var number))
        {
            tickets = db.Tickets.Where(t => t.Number == number && db.Projects.Any(p => p.Id == t.ProjectId && p.Key == projectKey));
        }
        else
        {
            return null;
        }

        return tickets.AsNoTracking().Select(t => new Row(
            t.Id,
            t.ProjectId,
            t.Number,
            t.DeletedAt,
            db.Users.Where(u => u.Id == t.DeletedById).Select(u => u.DisplayName).FirstOrDefault()));
    }

    private static AppException Deleted(string projectKey, Row row) =>
        AppException.NotFound(
            TicketErrors.Deleted,
            string.Create(CultureInfo.InvariantCulture,
                $"{HumanKeys.Ticket(projectKey, row.Number)} was deleted by {row.DeletedBy ?? "someone"} on {row.DeletedAt:yyyy-MM-dd}."));

    private sealed record Row(Guid Id, Guid ProjectId, int Number, DateTimeOffset? DeletedAt, string? DeletedBy);
}

/// <summary>Resolves user references (id, email or <c>me</c>) and applies the assignee rule (I-01).</summary>
public static class TicketUsers
{
    public const string Me = "me";

    public static async Task<Guid> AssigneeAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant project, string reference, CancellationToken cancellationToken)
    {
        var user = await FindAsync(db, currentUser, reference, cancellationToken)
            ?? throw Invalid("assignee", TicketErrors.AssigneeInvalid, $"User '{reference}' was not found.");
        if (!user.IsActive)
            throw Invalid("assignee", TicketErrors.AssigneeInvalid, $"{user.DisplayName} is deactivated and cannot be assigned.");

        var userId = user.Id;
        var membership = await db.ProjectMembers
            .Where(m => m.ProjectId == project.ProjectId && m.UserId == userId)
            .Select(m => (ProjectRole?)m.Role)
            .FirstOrDefaultAsync(cancellationToken);
        var role = ProjectAccessPolicy.Effective(user.IsActive, user.GlobalRole, project.Visibility, membership);
        if (!ProjectAccessPolicy.CanWrite(role))
            throw Invalid(
                "assignee", TicketErrors.AssigneeInvalid, $"{user.DisplayName} cannot edit tickets in {project.ProjectKey}, so they cannot be assigned.",
                "Add them to the project as a Member first.");
        return user.Id;
    }

    public static async Task<Guid> ReporterAsync(ITicketingDbContext db, ICurrentUser currentUser, string reference, CancellationToken cancellationToken)
    {
        var user = await FindAsync(db, currentUser, reference, cancellationToken)
            ?? throw Invalid("reporter", TicketErrors.ReporterInvalid, $"User '{reference}' was not found.");
        if (!user.IsActive)
            throw Invalid("reporter", TicketErrors.ReporterInvalid, $"{user.DisplayName} is deactivated.");
        return user.Id;
    }

    private static Task<UserRow?> FindAsync(ITicketingDbContext db, ICurrentUser currentUser, string reference, CancellationToken cancellationToken)
    {
        var value = reference.Trim();
        IQueryable<User> users;
        if (string.Equals(value, Me, StringComparison.OrdinalIgnoreCase))
        {
            var me = currentUser.Id;
            users = db.Users.Where(u => u.Id == me);
        }
        else if (Guid.TryParse(value, out var id))
        {
            users = db.Users.Where(u => u.Id == id);
        }
        else
        {
            var email = value.ToLowerInvariant();
            users = db.Users.Where(u => u.Email == email);
        }
        return users.AsNoTracking().Select(u => new UserRow(u.Id, u.DisplayName, u.IsActive, u.GlobalRole)).SingleOrDefaultAsync(cancellationToken);
    }

    private static AppException Invalid(string field, string code, string message, string? hint = null) =>
        new(ErrorKind.Validation, code, message, hint, new Dictionary<string, string[]> { [field] = [message] });

    private sealed record UserRow(Guid Id, string DisplayName, bool IsActive, GlobalRole GlobalRole);
}
