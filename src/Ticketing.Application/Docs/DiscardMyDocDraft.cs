using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;

namespace Ticketing.Application.Docs;

/// <summary>Discards the caller's draft; a no-op when there is none.</summary>
public static class DiscardMyDocDraft
{
    public sealed record Command(string KeyOrId);

    public sealed record Result(string DocKey, bool Discarded);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Command, Result>
    {
        public async Task<Result> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            currentUser.EnsureWriteScope();
            var target = await DocLookup.ReadAsync(db, access, command.KeyOrId, cancellationToken);
            var nodeId = target.Id;
            var me = currentUser.Id;
            var deleted = await db.DocDrafts.Where(d => d.NodeId == nodeId && d.UserId == me).ExecuteDeleteAsync(cancellationToken);
            return new Result(target.Key, deleted > 0);
        }
    }
}
