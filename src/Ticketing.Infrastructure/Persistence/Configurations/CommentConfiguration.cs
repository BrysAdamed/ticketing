using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
{
    public void Configure(EntityTypeBuilder<Comment> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("ck_comments_owner", "num_nonnulls(ticket_id, doc_node_id) = 1"));
        builder.HasKey(c => c.Id);
        builder.Property(c => c.RowVersion).IsXminRowVersion();
        builder.Ignore(c => c.IsDeleted);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<DocNode>().WithMany().HasForeignKey(c => c.DocNodeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(c => c.AuthorId).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(c => new { c.TicketId, c.CreatedAt });
        builder.HasIndex(c => new { c.DocNodeId, c.CreatedAt }).HasFilter("doc_node_id IS NOT NULL");
        builder.HasIndex(c => c.AuthorId);
    }
}
