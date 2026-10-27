using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Creates or replaces the caller's draft (autosave, spec 1.6): writers only, not in archived projects. The draft keeps
/// the version the edit started from; it is never published by saving it.
/// </summary>
public static class SaveMyDocDraft
{
    public sealed record Command(int? BaseVersion, string? Title, string? Content, [property: JsonIgnore] string KeyOrId = "") : IValidatable
    {
        public void Validate(Validator validator) =>
            validator
                .Must(BaseVersion is not null, "baseVersion", "baseVersion is required: the version the edit started from.")
                .MaxLength("title", Title, DocNode.TitleMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock) : IHandler<Command, DocDraftDto>
    {
        public async Task<DocDraftDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            var node = await db.DocNodes.AsNoTracking().SingleAsync(n => n.Id == target.Id, cancellationToken);
            node.EnsureHasContent();
            var me = currentUser.Id;
            var draft = await db.DocDrafts.SingleOrDefaultAsync(d => d.NodeId == node.Id && d.UserId == me, cancellationToken);
            if (draft is null)
                db.DocDrafts.Add(draft = DocDraft.Create(node, me, command.BaseVersion!.Value, command.Title, command.Content, clock.Now));
            else
                draft.Update(node, command.BaseVersion!.Value, command.Title, command.Content, clock.Now);
            await db.SaveChangesAsync(cancellationToken);
            return new DocDraftDto(target.Key, draft.BaseVersion, node.CurrentVersion, draft.Title, draft.Content, draft.CreatedAt, draft.UpdatedAt);
        }
    }
}
