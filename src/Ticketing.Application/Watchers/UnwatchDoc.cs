using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Watchers;

/// <summary>
/// The caller stops watching a page or diagram (I-85, D-161). It holds until the next automatic trigger (a comment, a mention).
/// Unwatching a doc one does not watch is a no-op.
/// </summary>
public static class UnwatchDoc
{
    public sealed record Command(string DocKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Command, WatchersDto>
    {
        public async Task<WatchersDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var doc = await DocWatcherQueries.WatchableAsync(db, access, command.DocKeyOrId, cancellationToken);
            currentUser.EnsureWriteScope();
            var (docId, me) = (doc.Id, currentUser.Id);
            await db.DocWatchers.Where(w => w.DocNodeId == docId && w.UserId == me).ExecuteDeleteAsync(cancellationToken);
            return await DocWatcherQueries.LoadAsync(db, currentUser, doc, cancellationToken);
        }
    }
}
