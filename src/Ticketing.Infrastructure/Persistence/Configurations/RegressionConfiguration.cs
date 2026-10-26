using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class RegressionSessionConfiguration : IEntityTypeConfiguration<RegressionSession>
{
    public void Configure(EntityTypeBuilder<RegressionSession> builder)
    {
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Name).HasMaxLength(RegressionSession.NameMaxLength);
        builder.Property(s => s.Version).HasMaxLength(RegressionSession.VersionMaxLength);
        builder.Property(s => s.RowVersion).IsXminRowVersion();

        builder.HasMany(s => s.Items).WithOne().HasForeignKey(i => i.SessionId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(s => s.Items).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasOne<Project>().WithMany().HasForeignKey(s => s.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.StartedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(s => new { s.ProjectId, s.Number }).IsUnique();
        builder.HasIndex(s => new { s.ProjectId, s.Status, s.StartedAt });
        builder.HasIndex(s => new { s.ProjectId, s.Version }).HasFilter("version IS NOT NULL");
    }
}

internal sealed class RegressionSessionItemConfiguration : IEntityTypeConfiguration<RegressionSessionItem>
{
    public void Configure(EntityTypeBuilder<RegressionSessionItem> builder)
    {
        builder.HasKey(i => i.Id);
        builder.Property(i => i.TestCaseKey).HasMaxLength(20);
        builder.Property(i => i.Title).HasMaxLength(TestCase.TitleMaxLength);
        builder.Property(i => i.Steps).HasColumnType("text[]");
        builder.Property(i => i.AutomationReference).HasMaxLength(TestCase.AutomationReferenceMaxLength);
        builder.Property(i => i.RowVersion).IsXminRowVersion();
        builder.Ignore(i => i.IsAutoPassed);

        builder.HasOne<TestCase>().WithMany().HasForeignKey(i => i.TestCaseId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.AssigneeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(i => i.BugTicketId).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(i => new { i.SessionId, i.TestCaseId }).IsUnique();
        builder.HasIndex(i => i.TestCaseId);
        builder.HasIndex(i => new { i.AssigneeId, i.Status }).HasFilter("assignee_id IS NOT NULL");
        builder.HasIndex(i => i.BugTicketId).HasFilter("bug_ticket_id IS NOT NULL");
    }
}
