using System.Globalization;
using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Find/replace edits applied atomically to the latest version (spec 1.7, MCP <c>edit_doc</c>): no <c>baseVersion</c>, so
/// they compose with concurrent edits. Every edit must match (<c>doc.edit.noMatch</c>) exactly once unless replaceAll
/// (<c>doc.edit.ambiguous</c>); one failure applies nothing. Pages and Mermaid diagrams only.
/// </summary>
public static class EditDoc
{
    public sealed record Command(IReadOnlyList<DocEdit>? Edits, string? ChangeNote = null, [property: JsonIgnore] string KeyOrId = "") : IValidatable
    {
        public void Validate(Validator validator)
        {
            validator
                .Must(Edits is { Count: >= 1 and <= DocEdits.MaxEdits }, "edits", $"Give 1..{DocEdits.MaxEdits} edits.")
                .MaxLength("changeNote", ChangeNote, DocNode.ChangeNoteMaxLength);
            for (var i = 0; i < (Edits?.Count ?? 0); i++)
                validator.Must(!string.IsNullOrEmpty(Edits![i].OldText), string.Create(CultureInfo.InvariantCulture, $"edits[{i}].oldText"), "oldText is required.");
        }
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, DocPublisher publisher)
        : IHandler<Command, DocDto>
    {
        public async Task<DocDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            await db.InTransactionAsync(
                async ct =>
                {
                    var node = await DocTree.LockNodeAsync(db, target.Id, ct);
                    node.EnsureHasContent();
                    if (node.DiagramFormat == DiagramFormat.Canvas)
                        throw AppException.Conflict(
                            DocErrors.KindUnsupported, "Canvas diagrams cannot be edited with find/replace.", "Replace the whole source with update_doc.");
                    var content = DocEdits.Apply(node.Content ?? string.Empty, command.Edits!);
                    if (!string.Equals(content, node.Content, StringComparison.Ordinal))
                        await publisher.PublishAsync(node, content, command.ChangeNote, null, ct);
                    await DocTree.SaveAsync(db, node.Title, ct);
                    return true;
                },
                cancellationToken);
            return await DocQueries.LoadAsync(db, currentUser, clock, target, cancellationToken);
        }
    }
}
