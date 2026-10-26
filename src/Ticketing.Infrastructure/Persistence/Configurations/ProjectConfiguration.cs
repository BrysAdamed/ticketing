using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Application.Projects;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Key).HasMaxLength(Project.KeyMaxLength);
        builder.Property(p => p.Name).HasMaxLength(Project.NameMaxLength);
        builder.Property<string>(ProjectSchema.NameNormalized).HasMaxLength(Project.NameMaxLength).HasComputedColumnSql("lower(name)", stored: true);
        builder.Property(p => p.RowVersion).IsXminRowVersion();
        builder.Ignore(p => p.IsArchived);
        builder.Ignore(p => p.IsDeleted);

        builder.HasMany(p => p.Members).WithOne().HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(p => p.Members).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasOne<User>().WithMany().HasForeignKey(p => p.CreatedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(p => p.Key).IsUnique().HasDatabaseName(ProjectSchema.KeyUniqueIndex);
        builder.HasIndex(ProjectSchema.NameNormalized).IsUnique().HasFilter("deleted_at IS NULL").HasDatabaseName(ProjectSchema.NameUniqueIndex);
    }
}
