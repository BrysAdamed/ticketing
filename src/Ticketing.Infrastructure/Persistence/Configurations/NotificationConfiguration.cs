using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("notifications");
        builder.HasKey(n => n.Id);
        builder.Property(n => n.Id).ValueGeneratedNever();
        builder.Property(n => n.Summary).HasMaxLength(Notification.SummaryMaxLength).IsRequired();
        builder.Property(n => n.TestCaseKey).HasMaxLength(20);
        builder.HasOne<User>().WithMany().HasForeignKey(n => n.RecipientId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(n => n.ActorId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Project>().WithMany().HasForeignKey(n => n.ProjectId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(n => n.TicketId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<RegressionSession>().WithMany().HasForeignKey(n => n.RegressionSessionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(n => new { n.RecipientId, n.ReadAt, n.CreatedAt, n.Id }).IncludeProperties(n => n.ProjectId);
        builder.HasIndex(n => new { n.RecipientId, n.CreatedAt, n.Id });
        builder.HasIndex(n => n.CreatedAt);
    }
}
