using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class TicketLinkConfiguration : IEntityTypeConfiguration<TicketLink>
{
    public void Configure(EntityTypeBuilder<TicketLink> builder)
    {
        builder.HasKey(l => l.Id);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(l => l.SourceTicketId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(l => l.TargetTicketId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(l => l.CreatedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(l => new { l.SourceTicketId, l.TargetTicketId, l.Type }).IsUnique();
        builder.HasIndex(l => l.TargetTicketId);
    }
}
