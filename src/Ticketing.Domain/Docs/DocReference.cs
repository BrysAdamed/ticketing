namespace Ticketing.Domain.Docs;

/// <summary>
/// A derived index entry: the latest content of <see cref="SourceNodeId"/> mentions a ticket or doc. Rebuilt on every
/// publish; cross-project targets are allowed and filtered for the reader when the index is read.
/// </summary>
public sealed class DocReference
{
    private DocReference()
    {
    }

    public Guid SourceNodeId { get; private set; }

    public DocReferenceTarget TargetType { get; private set; }

    public Guid TargetId { get; private set; }

    public static DocReference Create(Guid sourceNodeId, DocReferenceTarget targetType, Guid targetId) =>
        new() { SourceNodeId = sourceNodeId, TargetType = targetType, TargetId = targetId };
}
