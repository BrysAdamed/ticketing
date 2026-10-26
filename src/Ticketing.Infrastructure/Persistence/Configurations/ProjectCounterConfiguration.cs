using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Projects;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class ProjectCounterConfiguration : IEntityTypeConfiguration<ProjectCounter>
{
    public void Configure(EntityTypeBuilder<ProjectCounter> builder)
    {
        builder.HasKey(c => new { c.ProjectId, c.Kind });
        builder.HasOne<Project>().WithMany().HasForeignKey(c => c.ProjectId).OnDelete(DeleteBehavior.Cascade);
    }
}
