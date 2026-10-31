using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Watchers;

/// <summary>
/// The caller starts watching a page or diagram (I-85, D-162). Reading the doc is enough (viewers, archived projects); it changes
/// only the caller's own state, so it needs write-scoped credentials. Watching twice is a no-op.
/// </summary>
public static class WatchDoc
{
    public sealed record Command(string DocKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock) : IHandler<Command, WatchersDto>
    {
        public async Task<WatchersDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var doc = await DocWatcherQueries.WatchableAsync(db, access, command.DocKeyOrId, cancellationToken);
            currentUser.EnsureWriteScope();
            await db.Database.ExecuteSqlAsync(
                $"INSERT INTO doc_watchers (doc_node_id, user_id, created_at) VALUES ({doc.Id}, {currentUser.Id}, {clock.Now}) ON CONFLICT DO NOTHING",
                cancellationToken);
            return await DocWatcherQueries.LoadAsync(db, currentUser, doc, cancellationToken);
        }
    }
}
