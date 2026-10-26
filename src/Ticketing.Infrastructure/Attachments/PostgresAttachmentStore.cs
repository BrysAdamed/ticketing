using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Infrastructure.Attachments;

/// <summary>Stores bytes in <c>attachment_content</c>. Saves join the caller's unit of work; reads and deletes run immediately.</summary>
internal sealed class PostgresAttachmentStore(TicketingDbContext db) : IAttachmentStore
{
    public Task SaveAsync(Guid attachmentId, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        db.Set<AttachmentContent>().Add(new AttachmentContent { AttachmentId = attachmentId, Content = content.ToArray() });
        return Task.CompletedTask;
    }

    public async Task<Stream?> OpenReadAsync(Guid attachmentId, CancellationToken cancellationToken)
    {
        var content = await db.Set<AttachmentContent>()
            .AsNoTracking()
            .Where(c => c.AttachmentId == attachmentId)
            .Select(c => c.Content)
            .SingleOrDefaultAsync(cancellationToken);
        return content is null ? null : new MemoryStream(content, writable: false);
    }

    public Task DeleteAsync(Guid attachmentId, CancellationToken cancellationToken) =>
        db.Set<AttachmentContent>().Where(c => c.AttachmentId == attachmentId).ExecuteDeleteAsync(cancellationToken);
}
