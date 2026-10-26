using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.FeatureFlags;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class FeatureFlagConfiguration : IEntityTypeConfiguration<FeatureFlag>
{
    public void Configure(EntityTypeBuilder<FeatureFlag> builder)
    {
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Key).HasMaxLength(FeatureFlag.KeyMaxLength);
        builder.Property(f => f.Description).HasMaxLength(FeatureFlag.DescriptionMaxLength);
        builder.Property(f => f.TargetUserIds).HasColumnType("uuid[]");
        builder.PrimitiveCollection(f => f.TargetRoles).HasColumnType("integer[]");
        builder.Property(f => f.RowVersion).IsXminRowVersion();
        builder.HasIndex(f => f.Key).IsUnique();
    }
}
