using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class ProjectMemberConfiguration : IEntityTypeConfiguration<ProjectMember>
{
    public void Configure(EntityTypeBuilder<ProjectMember> builder)
    {
        builder.HasKey(m => new { m.ProjectId, m.UserId });
        builder.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(m => m.UserId);
    }
}
