using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class BoardConfiguration : IEntityTypeConfiguration<Board>
{
    public void Configure(EntityTypeBuilder<Board> builder)
    {
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Name).HasMaxLength(Board.NameMaxLength);
        builder.Property(b => b.RowVersion).IsXminRowVersion();
        builder.Ignore(b => b.IsArchived);
        builder.Ignore(b => b.IsDeleted);

        builder.HasMany(b => b.Projects).WithOne().HasForeignKey(bp => bp.BoardId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(b => b.Projects).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasOne<User>().WithMany().HasForeignKey(b => b.OwnerId).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(b => b.OwnerId);
        builder.HasIndex(b => b.Name).HasFilter("deleted_at IS NULL");
    }
}

internal sealed class BoardProjectConfiguration : IEntityTypeConfiguration<BoardProject>
{
    public void Configure(EntityTypeBuilder<BoardProject> builder)
    {
        builder.HasKey(bp => new { bp.BoardId, bp.ProjectId });
        builder.HasOne<Project>().WithMany().HasForeignKey(bp => bp.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(bp => bp.ProjectId);
    }
}
