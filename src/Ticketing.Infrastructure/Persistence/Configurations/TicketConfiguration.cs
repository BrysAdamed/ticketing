using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NpgsqlTypes;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class TicketConfiguration : IEntityTypeConfiguration<Ticket>
{
    private const string SearchVector = TicketSearch.VectorProperty;

    public void Configure(EntityTypeBuilder<Ticket> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Title).HasMaxLength(Ticket.TitleMaxLength);
        builder.Property(t => t.Version).HasMaxLength(Ticket.VersionMaxLength);
        builder.Property(t => t.Rank).HasMaxLength(Ranks.ColumnMaxLength).UseCollation("C");
        builder.Property(t => t.Labels).HasColumnType("text[]");
        builder.Property(t => t.RowVersion).IsXminRowVersion();
        builder.Ignore(t => t.IsDeleted);
        builder.Ignore(t => t.IsInBacklog);

        builder.Property<NpgsqlTsVector>(SearchVector)
            .HasColumnType("tsvector")
            .HasComputedColumnSql(
                "setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || " +
                "setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')",
                stored: true);

        builder.HasOne<Project>().WithMany().HasForeignKey(t => t.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Ticket>().WithMany().HasForeignKey(t => t.ParentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Board>().WithMany().HasForeignKey(t => t.BoardId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.AssigneeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.ReporterId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(t => new { t.ProjectId, t.Number }).IsUnique();
        builder.HasIndex(t => new { t.ProjectId, t.BoardId, t.Rank }).HasFilter("deleted_at IS NULL").HasDatabaseName("ix_tickets_container_rank");
        builder.HasIndex(t => new { t.BoardId, t.Rank }).HasFilter("board_id IS NOT NULL AND deleted_at IS NULL").HasDatabaseName("ix_tickets_board_rank");
        builder.HasIndex(t => new { t.ProjectId, t.Status }).HasFilter("deleted_at IS NULL");
        builder.HasIndex(t => new { t.ProjectId, t.Type }).HasFilter("deleted_at IS NULL");
        builder.HasIndex(t => new { t.ProjectId, t.UpdatedAt }).HasFilter("deleted_at IS NULL");
        builder.HasIndex(t => new { t.ProjectId, t.CreatedAt }).HasFilter("deleted_at IS NULL");
        builder.HasIndex(t => new { t.UpdatedAt, t.Id }).IsDescending(true, true).HasFilter("deleted_at IS NULL").HasDatabaseName("ix_tickets_updated_search");
        builder.HasIndex(t => new { t.CreatedAt, t.Id }).IsDescending(true, true).HasFilter("deleted_at IS NULL").HasDatabaseName("ix_tickets_created_search");
        builder.HasIndex(t => new { t.ProjectId, t.ResolvedAt }).HasFilter("deleted_at IS NULL AND resolved_at IS NOT NULL");
        builder.HasIndex(t => new { t.ProjectId, t.Version }).HasFilter("deleted_at IS NULL AND version IS NOT NULL");
        builder.HasIndex(t => new { t.AssigneeId, t.Status }).HasFilter("deleted_at IS NULL AND assignee_id IS NOT NULL");
        builder.HasIndex(t => t.ReporterId);
        builder.HasIndex(t => t.CreatedById);
        builder.HasIndex(t => t.ParentId).HasFilter("parent_id IS NOT NULL");
        builder.HasIndex(t => t.Labels).HasMethod("gin");
        builder.HasIndex(t => t.Title).HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_tickets_title_trgm");
        builder.HasIndex(SearchVector).HasMethod("gin").HasDatabaseName("ix_tickets_search_vector");
    }
}
