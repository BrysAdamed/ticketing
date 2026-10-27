using Ticketing.Application.Docs;

namespace Ticketing.Api.DemoData;

internal sealed partial class DemoScript
{
    private readonly Dictionary<string, PlannedDoc> _docs = new(StringComparer.Ordinal);
    private int _docComments;

    /// <summary>
    /// Schedules <see cref="DemoDocs"/>: each doc, version and comment after everything it mentions exists, so every key
    /// it writes is real and the reference index picks it up. Runs after the other plans, so it does not change their draws.
    /// </summary>
    private void PlanDocs()
    {
        foreach (var tree in DemoDocs.Trees)
        {
            foreach (var doc in tree.Docs)
                PlanDocCreation(tree.ProjectKey, doc);
        }
        foreach (var planned in _docs.Values)
            PlanDocChanges(planned);
    }

    private void PlanDocCreation(string projectKey, DemoDoc doc)
    {
        var parent = doc.Folder is { } folder
            ? _docs.GetValueOrDefault(folder) ?? throw new InvalidOperationException($"Demo doc '{doc.Handle}' is listed before its folder '{folder}'.")
            : null;
        var planned = new PlannedDoc(doc);
        if (!_docs.TryAdd(doc.Handle, planned))
            throw new InvalidOperationException($"Duplicate demo doc handle '{doc.Handle}'.");

        var refs = new DocRefs(this, planning: true);
        planned.Content = doc.Content?.Invoke(refs) ?? string.Empty;
        planned.CreatedAt = Later(Max(refs.Latest, parent?.CreatedAt ?? DateTimeOffset.MinValue), Day(doc.DaysAgo));
        Schedule(planned.CreatedAt, ct => CreateDocAsync(projectKey, planned, parent, ct));
    }

    /// <summary>Versions and comments, planned once every doc has a creation time, so they may link any demo doc.</summary>
    private void PlanDocChanges(PlannedDoc planned)
    {
        var doc = planned.Doc;
        var text = planned.Content;
        var last = planned.CreatedAt;
        foreach (var revision in doc.Revisions ?? [])
        {
            var revisionRefs = new DocRefs(this, planning: true);
            var next = revision.Edit(revisionRefs, text);
            if (next == text)
                throw new InvalidOperationException($"Revision '{revision.ChangeNote}' of demo doc '{doc.Handle}' changes nothing.");
            text = next;
            last = Later(Max(last, revisionRefs.Latest), Day(revision.DaysAgo));
            Schedule(last, ct => ReviseDocAsync(planned, revision, ct));
        }

        foreach (var comment in doc.Comments ?? [])
        {
            var commentRefs = new DocRefs(this, planning: true);
            comment.Body(commentRefs);
            Schedule(Later(Max(planned.CreatedAt, commentRefs.Latest), Day(comment.DaysAgo)), async ct =>
            {
                await workspace.AddDocCommentAsync(User(comment.Author), Clock(), planned.Key, comment.Body(new DocRefs(this, planning: false)), ct);
                _docComments++;
            });
        }
    }

    private async Task CreateDocAsync(string projectKey, PlannedDoc planned, PlannedDoc? parent, CancellationToken ct)
    {
        var doc = planned.Doc;
        var content = doc.Canvas?.Scene() ?? doc.Content?.Invoke(new DocRefs(this, planning: false));
        var command = new CreateDoc.Command(
            doc.Kind, doc.Title, Parent: parent?.Key, Content: content, DiagramFormat: doc.Format, Snapshot: doc.Canvas?.Svg(),
            ProjectKeyOrId: projectKey);
        var created = await workspace.CreateDocAsync(User(doc.Author), Clock(), command, ct);
        (planned.Key, planned.Version, planned.Content) = (created.Key, created.Version, content ?? string.Empty);
    }

    private async Task ReviseDocAsync(PlannedDoc planned, DemoDocRevision revision, CancellationToken ct)
    {
        var content = revision.Edit(new DocRefs(this, planning: false), planned.Content);
        var command = new UpdateDoc.Command { KeyOrId = planned.Key, Content = content, BaseVersion = planned.Version, ChangeNote = revision.ChangeNote };
        var updated = await workspace.UpdateDocAsync(User(revision.Author), Clock(), command, ct);
        (planned.Version, planned.Content) = (updated.Version, content);
    }

    /// <summary>
    /// Keys for doc content. While planning it returns placeholders and remembers the latest creation time of what was
    /// mentioned; while replaying it returns the real keys.
    /// </summary>
    private sealed class DocRefs(DemoScript script, bool planning) : IDemoDocRefs
    {
        public DateTimeOffset Latest { get; private set; } = DateTimeOffset.MinValue;

        public string Ticket(string title)
        {
            var ticket = script._byTitle.GetValueOrDefault(title) ?? throw new InvalidOperationException($"Demo docs mention an unknown ticket '{title}'.");
            Latest = Max(Latest, ticket.CreatedAt);
            return planning ? "DEMO-1" : ticket.Key;
        }

        public string Doc(string handle)
        {
            var doc = script._docs.GetValueOrDefault(handle) ?? throw new InvalidOperationException($"Demo docs link '{handle}' before it is listed.");
            Latest = Max(Latest, doc.CreatedAt);
            return planning ? "DEMO-D-1" : doc.Key;
        }
    }

    private sealed class PlannedDoc(DemoDoc doc)
    {
        public DemoDoc Doc { get; } = doc;

        public DateTimeOffset CreatedAt { get; set; }

        public string Key { get; set; } = string.Empty;

        public int Version { get; set; }

        public string Content { get; set; } = string.Empty;
    }
}
