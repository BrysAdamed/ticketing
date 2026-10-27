using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Search;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Common;

namespace Ticketing.Application.Notifications;

/// <summary>
/// The caller's notifications, newest first (by when the first merged event happened), optionally only unread ones. Read
/// access is checked again here, so notifications about projects the caller can no longer read are not shown.
/// </summary>
public static class ListNotifications
{
    public sealed record Query(bool UnreadOnly = false, PageRequest? Page = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, CursorPage<NotificationDto>>
    {
        public async Task<CursorPage<NotificationDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var page = request.Page ?? new PageRequest();
            var after = Cursor.Decode<NotificationCursor>(page.Cursor);
            var notifications = NotificationQueries.Own(db, currentUser);
            if (request.UnreadOnly)
                notifications = notifications.Where(n => n.ReadAt == null);
            if (after is not null)
                notifications = notifications.Where(n => n.CreatedAt < after.At || (n.CreatedAt == after.At && n.Id.CompareTo(after.Id) < 0));

            var rows = await (
                    from n in notifications
                    join p in access.ReadableProjects() on n.ProjectId equals p.Id
                    join t in db.Tickets on n.TicketId equals (Guid?)t.Id into tickets
                    from t in tickets.DefaultIfEmpty()
                    join s in db.RegressionSessions on n.RegressionSessionId equals (Guid?)s.Id into sessions
                    from s in sessions.DefaultIfEmpty()
                    join d in db.DocNodes on n.DocNodeId equals (Guid?)d.Id into docs
                    from d in docs.DefaultIfEmpty()
                    join u in db.Users on n.ActorId equals (Guid?)u.Id into actors
                    from u in actors.DefaultIfEmpty()
                    orderby n.CreatedAt descending, n.Id descending
                    select new Row(
                        n.Id,
                        n.Kind,
                        n.Summary,
                        n.EventCount,
                        u == null ? null : new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive),
                        p.Key,
                        t == null ? null : (int?)t.Number,
                        t == null ? null : t.Title,
                        t != null && t.DeletedAt != null,
                        s == null ? null : (int?)s.Number,
                        s == null ? null : s.Name,
                        n.TestCaseKey,
                        d == null ? null : (int?)d.Number,
                        d == null ? null : d.Title,
                        d != null && d.DeletedAt != null,
                        n.CreatedAt,
                        n.UpdatedAt,
                        n.ReadAt))
                .ToCursorPageAsync(page, r => new NotificationCursor(r.CreatedAt, r.Id), cancellationToken);

            return rows.Map(ToDto);
        }

        private static NotificationDto ToDto(Row r)
        {
            NotificationTicketDto? ticket = null;
            NotificationRegressionDto? regression = null;
            NotificationDocDto? doc = null;
            var url = $"/projects/{r.ProjectKey}";
            if (r.TicketNumber is { } number)
            {
                var key = HumanKeys.Ticket(r.ProjectKey, number);
                ticket = new NotificationTicketDto(key, r.TicketTitle!, r.TicketDeleted);
                url = TicketQueries.Url(key);
            }
            else if (r.SessionNumber is { } session && r.TestCaseKey is { } testCaseKey)
            {
                var sessionKey = HumanKeys.Regression(r.ProjectKey, session);
                regression = new NotificationRegressionDto(sessionKey, r.SessionName!, testCaseKey);
                url = SearchUrls.RegressionItem(r.ProjectKey, sessionKey, testCaseKey);
            }
            else if (r.DocNumber is { } docNumber)
            {
                var key = HumanKeys.Doc(r.ProjectKey, docNumber);
                doc = new NotificationDocDto(key, r.DocTitle!, r.DocDeleted);
                url = DocQueries.Url(r.ProjectKey, key, r.DocTitle!) + "#comments";
            }
            return new NotificationDto(
                r.Id, r.Kind, r.Summary, r.EventCount, r.Actor, r.ProjectKey, ticket, regression, doc, url, r.CreatedAt, r.UpdatedAt, r.ReadAt);
        }

        private sealed record Row(
            Guid Id,
            NotificationKind Kind,
            string Summary,
            int EventCount,
            UserRefDto? Actor,
            string ProjectKey,
            int? TicketNumber,
            string? TicketTitle,
            bool TicketDeleted,
            int? SessionNumber,
            string? SessionName,
            string? TestCaseKey,
            int? DocNumber,
            string? DocTitle,
            bool DocDeleted,
            DateTimeOffset CreatedAt,
            DateTimeOffset UpdatedAt,
            DateTimeOffset? ReadAt);

        private sealed record NotificationCursor(DateTimeOffset At, Guid Id);
    }
}
