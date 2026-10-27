using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("ck_attachments_owner", "num_nonnulls(ticket_id, doc_node_id) = 1"));
        builder.HasKey(a => a.Id);
        builder.Property(a => a.FileName).HasMaxLength(Attachment.FileNameMaxLength);
        builder.Property(a => a.ContentType).HasMaxLength(100);
        builder.Property(a => a.Sha256).HasMaxLength(64);
        builder.Ignore(a => a.IsImage);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(a => a.TicketId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.UploadedById).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<DocNode>().WithMany().HasForeignKey(a => a.DocNodeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => a.TicketId);
        builder.HasIndex(a => a.DocNodeId).HasFilter("doc_node_id IS NOT NULL");
    }
}

internal sealed class AttachmentContentConfiguration : IEntityTypeConfiguration<AttachmentContent>
{
    public void Configure(EntityTypeBuilder<AttachmentContent> builder)
    {
        builder.ToTable("attachment_content");
        builder.HasKey(c => c.AttachmentId);
        builder.Property(c => c.Content).HasColumnType("bytea");
        builder.HasOne<Attachment>().WithOne().HasForeignKey<AttachmentContent>(c => c.AttachmentId).OnDelete(DeleteBehavior.Cascade);
    }
}
