using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class PersonalAccessTokenConfiguration : IEntityTypeConfiguration<PersonalAccessToken>
{
    public void Configure(EntityTypeBuilder<PersonalAccessToken> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasMaxLength(PersonalAccessToken.NameMaxLength);
        builder.Property<string>("NameNormalized").HasMaxLength(PersonalAccessToken.NameMaxLength).HasComputedColumnSql("lower(name)", stored: true);
        builder.Property(t => t.Prefix).HasMaxLength(PersonalAccessToken.DisplayPrefixLength);
        builder.Property(t => t.TokenHash).HasMaxLength(64);

        builder.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => t.UserId);
        builder.HasIndex("UserId", "NameNormalized").IsUnique().HasFilter("revoked_at IS NULL").HasDatabaseName("ix_personal_access_tokens_user_id_name_active");
    }
}
