using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Idempotency;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class IdempotencyRecordConfiguration : IEntityTypeConfiguration<IdempotencyRecord>
{
    public void Configure(EntityTypeBuilder<IdempotencyRecord> builder)
    {
        builder.HasKey(r => new { r.UserId, r.Key });
        builder.Property(r => r.Key).HasMaxLength(IdempotencyRecord.KeyMaxLength);
        builder.Property(r => r.Operation).HasMaxLength(IdempotencyRecord.OperationMaxLength);
        builder.Property(r => r.RequestHash).HasMaxLength(64);
        builder.Property(r => r.ResultJson).HasColumnType("jsonb");
        builder.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(r => r.ExpiresAt);
    }
}
