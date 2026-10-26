namespace Ticketing.Infrastructure.Persistence;

/// <summary>Attachment bytes, stored apart from the metadata so listing attachments never loads content.</summary>
public sealed class AttachmentContent
{
    public required Guid AttachmentId { get; init; }

    public required byte[] Content { get; init; }
}
