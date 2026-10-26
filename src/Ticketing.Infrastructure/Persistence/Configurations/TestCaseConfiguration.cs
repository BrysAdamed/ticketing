using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Projects;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class TestCaseConfiguration : IEntityTypeConfiguration<TestCase>
{
    public void Configure(EntityTypeBuilder<TestCase> builder)
    {
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Title).HasMaxLength(TestCase.TitleMaxLength);
        builder.Property(c => c.Steps).HasColumnType("text[]");
        builder.Property(c => c.AutomationReference).HasMaxLength(TestCase.AutomationReferenceMaxLength);
        builder.Property(c => c.RowVersion).IsXminRowVersion();
        builder.Ignore(c => c.IsArchived);
        builder.Ignore(c => c.IsEligibleForRegression);

        builder.HasOne<Project>().WithMany().HasForeignKey(c => c.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.SetNull);

        builder.HasIndex(c => new { c.ProjectId, c.Number }).IsUnique();
        builder.HasIndex(c => new { c.ProjectId, c.Status }).HasFilter("archived_at IS NULL");
        builder.HasIndex(c => c.TicketId).HasFilter("ticket_id IS NOT NULL");
        builder.HasIndex(c => c.Title).HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_test_cases_title_trgm");
    }
}
