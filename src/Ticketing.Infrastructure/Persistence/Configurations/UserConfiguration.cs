using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Email).HasMaxLength(User.EmailMaxLength);
        builder.Property(u => u.DisplayName).HasMaxLength(User.DisplayNameMaxLength);
        builder.Property(u => u.SetPasswordTokenHash).HasMaxLength(64);
        builder.Property(u => u.SecurityStamp).HasMaxLength(User.SecurityStampLength);
        builder.Property(u => u.RowVersion).IsXminRowVersion();

        builder.HasIndex(u => u.Email).IsUnique();
        builder.HasIndex(u => u.SetPasswordTokenHash).IsUnique().HasFilter("set_password_token_hash IS NOT NULL");
    }
}
