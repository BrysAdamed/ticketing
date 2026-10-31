using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class DocWatcherConfiguration : IEntityTypeConfiguration<DocWatcher>
{
    public void Configure(EntityTypeBuilder<DocWatcher> builder)
    {
        builder.ToTable("doc_watchers");
        builder.HasKey(w => new { w.DocNodeId, w.UserId });
        builder.HasOne<DocNode>().WithMany().HasForeignKey(w => w.DocNodeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(w => w.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(w => new { w.UserId, w.DocNodeId });
    }
}
