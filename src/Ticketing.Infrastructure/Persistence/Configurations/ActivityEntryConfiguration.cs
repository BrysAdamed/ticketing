using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Activity;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class ActivityEntryConfiguration : IEntityTypeConfiguration<ActivityEntry>
{
    public void Configure(EntityTypeBuilder<ActivityEntry> builder)
    {
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Action).HasMaxLength(ActivityEntry.ActionMaxLength);
        builder.Property(a => a.Field).HasMaxLength(ActivityEntry.FieldMaxLength);
        builder.Property(a => a.OldValue).HasColumnType("jsonb");
        builder.Property(a => a.NewValue).HasColumnType("jsonb");

        builder.HasIndex(a => new { a.EntityType, a.EntityId, a.OccurredAt });
        builder.HasIndex(a => new { a.ProjectId, a.OccurredAt }).HasFilter("project_id IS NOT NULL");
        builder.HasIndex(a => new { a.ActorId, a.OccurredAt }).HasFilter("actor_id IS NOT NULL");
        builder.HasIndex(a => a.OccurredAt);
    }
}
