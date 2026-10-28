using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Onboarding;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class UserGuideStateConfiguration : IEntityTypeConfiguration<UserGuideState>
{
    public void Configure(EntityTypeBuilder<UserGuideState> builder)
    {
        builder.ToTable("user_guide_state");
        builder.HasKey(s => new { s.UserId, s.GuideId });
        builder.Property(s => s.GuideId).HasMaxLength(UserGuideState.GuideIdMaxLength);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
