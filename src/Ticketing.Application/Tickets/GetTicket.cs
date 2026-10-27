using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Collaboration;
using Ticketing.Application.Comments;
using Ticketing.Application.Docs;
using Ticketing.Application.Watchers;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Tickets;

[Flags]
public enum TicketIncludes
{
    None = 0,
    Comments = 1,
    Children = 2,
    Links = 4,
    TestCases = 8,
    Watchers = 16,
    Docs = 32,
    All = Comments | Children | Links | TestCases | Watchers,
    Everything = All | Docs,
}

/// <summary>A ticket with its fields and, on request, its children (with progress), links, latest comments and test cases.</summary>
public static class GetTicket
{
    public const int LatestComments = 50;

    public sealed record Query(string KeyOrId, TicketIncludes Include = TicketIncludes.All);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, TicketDto>
    {
        public async Task<TicketDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await TicketLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            return await LoadAsync(db, access, currentUser, target, request.Include, cancellationToken);
        }

        /// <summary>
        /// Parses <c>comments,children,links,testCases,watchers,docs</c> (case-insensitive); null or empty means
        /// <paramref name="fallback"/> (<see cref="TicketIncludes.All"/>, which leaves out the opt-in docs). Unknown names are ignored.
        /// </summary>
        public static TicketIncludes ParseIncludes(IEnumerable<string>? names, TicketIncludes fallback = TicketIncludes.All)
        {
            var list = names?.SelectMany(n => n.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToList();
            if (list is null || list.Count == 0)
                return fallback;
            var result = TicketIncludes.None;
            foreach (var name in list)
            {
                if (Enum.TryParse<TicketIncludes>(name, ignoreCase: true, out var flag))
                    result |= flag;
            }
            return result;
        }

        internal static async Task<TicketDto> LoadAsync(
            ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, TicketTarget target, TicketIncludes include, CancellationToken cancellationToken)
        {
            var id = target.Id;
            var row = await (
                    from t in db.Tickets.AsNoTracking()
                    where t.Id == id
                    join p in db.Projects on t.ProjectId equals p.Id
                    join r in db.Users on t.ReporterId equals r.Id
                    join c in db.Users on t.CreatedById equals c.Id
                    from a in db.Users.Where(u => u.Id == t.AssigneeId).DefaultIfEmpty()
                    from parent in db.Tickets.Where(x => x.Id == t.ParentId).DefaultIfEmpty()
                    from pa in db.Users.Where(u => u.Id == parent.AssigneeId).DefaultIfEmpty()
                    from b in db.Boards.Where(x => x.Id == t.BoardId).DefaultIfEmpty()
                    select new
                    {
                        Ticket = t,
                        ProjectName = p.Name,
                        Reporter = new UserRefDto(r.Id, r.Email, r.DisplayName, r.IsActive),
                        CreatedBy = new UserRefDto(c.Id, c.Email, c.DisplayName, c.IsActive),
                        AssigneeId = (Guid?)a.Id,
                        AssigneeEmail = a.Email,
                        AssigneeName = a.DisplayName,
                        AssigneeActive = (bool?)a.IsActive,
                        ParentId = (Guid?)parent.Id,
                        ParentNumber = (int?)parent.Number,
                        ParentTitle = parent.Title,
                        ParentType = (TicketType?)parent.Type,
                        ParentStatus = (TicketStatus?)parent.Status,
                        ParentPriority = (Priority?)parent.Priority,
                        ParentAssigneeId = (Guid?)pa.Id,
                        ParentAssigneeEmail = pa.Email,
                        ParentAssigneeName = pa.DisplayName,
                        ParentAssigneeActive = (bool?)pa.IsActive,
                        BoardName = b.Name,
                    })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw TicketLookup.NotFound(target.Key);

            var projectKey = target.Grant.ProjectKey;
            var ticket = row.Ticket;
            var key = HumanKeys.Ticket(projectKey, ticket.Number);
            var parentRef = row.ParentId is { } parentId
                ? new TicketRefDto(
                    parentId, HumanKeys.Ticket(projectKey, row.ParentNumber!.Value), row.ParentTitle!, row.ParentType!.Value, row.ParentStatus!.Value,
                    row.ParentPriority!.Value, TicketQueries.User(row.ParentAssigneeId, row.ParentAssigneeEmail, row.ParentAssigneeName, row.ParentAssigneeActive))
                : null;

            IReadOnlyList<TicketRefDto>? children = null;
            ProgressDto? progress = null;
            if (include.HasFlag(TicketIncludes.Children))
            {
                children = await ChildrenAsync(db, projectKey, id, cancellationToken);
                progress = TicketQueries.Progress(children.Select(c => c.Status));
            }

            var links = include.HasFlag(TicketIncludes.Links) ? await LinksAsync(db, access, id, cancellationToken) : null;

            IReadOnlyList<CommentDto>? comments = null;
            int? commentCount = null;
            if (include.HasFlag(TicketIncludes.Comments))
            {
                commentCount = await db.Comments.CountAsync(c => c.TicketId == id, cancellationToken);
                comments = await CommentQueries.LatestAsync(db, currentUser, target.Grant, id, LatestComments, cancellationToken);
            }

            var testCases = include.HasFlag(TicketIncludes.TestCases) ? await TestCasesAsync(db, projectKey, id, cancellationToken) : null;
            var watchers = include.HasFlag(TicketIncludes.Watchers) ? await WatcherQueries.LoadAsync(db, currentUser, target, cancellationToken) : null;
            var docs = include.HasFlag(TicketIncludes.Docs) ? await GetTicketDocs.Handler.LoadAsync(db, access, id, GetTicketDocs.DefaultLimit, cancellationToken) : null;

            var mentioned = await MentionedUsers.LoadAsync(db, ticket.ProjectId, [ticket.Description], cancellationToken);
            var canWrite = target.Grant.CanWrite && !target.Grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly;
            var permissions = new TicketPermissionsDto(canWrite, canWrite && target.Grant.IsOwner, canWrite);

            return new TicketDto(
                ticket.Id, key, ticket.ProjectId, projectKey, row.ProjectName, ticket.Number, ticket.Title, ticket.Description, ticket.Type, ticket.Status,
                ticket.Resolution, ticket.Priority, ticket.Severity, ticket.StoryPoints, ticket.Version, ticket.Labels, parentRef,
                TicketQueries.Location(ticket.BoardId, row.BoardName),
                TicketQueries.User(row.AssigneeId, row.AssigneeEmail, row.AssigneeName, row.AssigneeActive), row.Reporter, row.CreatedBy,
                ticket.CreatedAt, ticket.UpdatedAt, ticket.StatusChangedAt, ticket.ResolvedAt, target.Grant.Role, permissions, TicketQueries.Url(key), ticket.RowVersion,
                children, progress, links, comments, commentCount, testCases, watchers, MentionedUsers.In(ticket.Description, mentioned), docs);
        }

        private static async Task<IReadOnlyList<TicketRefDto>> ChildrenAsync(ITicketingDbContext db, string projectKey, Guid id, CancellationToken cancellationToken)
        {
            var rows = await (
                    from c in db.Tickets.AsNoTracking()
                    where c.ParentId == id && c.DeletedAt == null
                    from a in db.Users.Where(u => u.Id == c.AssigneeId).DefaultIfEmpty()
                    orderby c.Number
                    select new
                    {
                        c.Id, c.Number, c.Title, c.Type, c.Status, c.Priority,
                        AssigneeId = (Guid?)a.Id, AssigneeEmail = a.Email, AssigneeName = a.DisplayName, AssigneeActive = (bool?)a.IsActive,
                    })
                .ToListAsync(cancellationToken);
            return [.. rows.Select(r => new TicketRefDto(
                r.Id, HumanKeys.Ticket(projectKey, r.Number), r.Title, r.Type, r.Status, r.Priority,
                TicketQueries.User(r.AssigneeId, r.AssigneeEmail, r.AssigneeName, r.AssigneeActive)))];
        }

        private static async Task<IReadOnlyList<TicketLinkDto>> LinksAsync(ITicketingDbContext db, IProjectAccess access, Guid id, CancellationToken cancellationToken)
        {
            var readable = access.ReadableProjects();
            var rows = await (
                    from l in db.TicketLinks.AsNoTracking()
                    where l.SourceTicketId == id || l.TargetTicketId == id
                    let otherId = l.SourceTicketId == id ? l.TargetTicketId : l.SourceTicketId
                    join o in db.Tickets on otherId equals o.Id
                    where o.DeletedAt == null && readable.Any(p => p.Id == o.ProjectId)
                    join p in db.Projects on o.ProjectId equals p.Id
                    from a in db.Users.Where(u => u.Id == o.AssigneeId).DefaultIfEmpty()
                    select new
                    {
                        l.Id, l.Type, l.SourceTicketId, l.CreatedAt,
                        OtherId = o.Id, ProjectKey = p.Key, o.Number, o.Title, OtherType = o.Type, o.Status, o.Priority,
                        AssigneeId = (Guid?)a.Id, AssigneeEmail = a.Email, AssigneeName = a.DisplayName, AssigneeActive = (bool?)a.IsActive,
                    })
                .ToListAsync(cancellationToken);

            return [.. rows
                .Select(r =>
                {
                    var direction = r.Type == TicketLinkType.RelatesTo || r.SourceTicketId == id ? LinkDirection.Outward : LinkDirection.Inward;
                    var other = new TicketRefDto(
                        r.OtherId, HumanKeys.Ticket(r.ProjectKey, r.Number), r.Title, r.OtherType, r.Status, r.Priority,
                        TicketQueries.User(r.AssigneeId, r.AssigneeEmail, r.AssigneeName, r.AssigneeActive));
                    return new TicketLinkDto(r.Id, r.Type, direction, TicketQueries.LinkLabel(r.Type, direction), other, r.CreatedAt);
                })
                .OrderBy(l => l.Type)
                .ThenBy(l => l.Direction)
                .ThenBy(l => l.CreatedAt)];
        }

        private static async Task<IReadOnlyList<TestCaseRefDto>> TestCasesAsync(ITicketingDbContext db, string projectKey, Guid id, CancellationToken cancellationToken)
        {
            var rows = await db.TestCases.AsNoTracking()
                .Where(c => c.TicketId == id && c.ArchivedAt == null)
                .OrderBy(c => c.Number)
                .Select(c => new { c.Id, c.Number, c.Title, c.Status, StepCount = c.Steps.Count })
                .ToListAsync(cancellationToken);
            return [.. rows.Select(r => new TestCaseRefDto(r.Id, HumanKeys.TestCase(projectKey, r.Number), r.Title, r.Status, r.StepCount))];
        }
    }
}
