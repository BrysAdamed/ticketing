using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class UserAchievementConfiguration : IEntityTypeConfiguration<UserAchievement>
{
    public void Configure(EntityTypeBuilder<UserAchievement> builder)
    {
        builder.HasKey(a => new { a.UserId, a.AchievementId, a.Tier });
        builder.Property(a => a.AchievementId).HasMaxLength(AchievementDefinition.IdMaxLength);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class AchievementProjectorStateConfiguration : IEntityTypeConfiguration<AchievementProjectorState>
{
    public void Configure(EntityTypeBuilder<AchievementProjectorState> builder)
    {
        builder.ToTable("achievement_projector_state");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
    }
}
