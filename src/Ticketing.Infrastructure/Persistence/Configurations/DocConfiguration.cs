using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NpgsqlTypes;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

/// <summary>
/// The sibling-title rule is an expression index the model cannot express; the AddDocs migration creates it as
/// <c>ux_doc_nodes_sibling_title</c> on (project_id, parent_id, lower(title)) NULLS NOT DISTINCT WHERE deleted_at IS NULL.
/// </summary>
internal sealed class DocNodeConfiguration : IEntityTypeConfiguration<DocNode>
{
    public void Configure(EntityTypeBuilder<DocNode> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint(
            "ck_doc_nodes_diagram_format", "(kind = 3) = (diagram_format IS NOT NULL)"));
        builder.HasKey(n => n.Id);
        builder.Property(n => n.Title).HasMaxLength(DocNode.TitleMaxLength);
        builder.Property(n => n.Rank).HasMaxLength(Ranks.ColumnMaxLength).UseCollation("C");
        builder.Property(n => n.Content).UseCompressionMethod("lz4");
        builder.Property(n => n.Outline).UseCompressionMethod("lz4");
        builder.Property(n => n.RowVersion).IsXminRowVersion();
        builder.Ignore(n => n.IsDeleted);
        builder.Ignore(n => n.IsFolder);

        builder.Property<NpgsqlTsVector>(DocSearch.VectorProperty)
            .HasColumnType("tsvector")
            .HasComputedColumnSql(
                "setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || " +
                "setweight(to_tsvector('english'::regconfig, CASE WHEN diagram_format = 2 THEN coalesce(outline, '') ELSE coalesce(content, '') END), 'B')",
                stored: true);

        builder.HasOne<Project>().WithMany().HasForeignKey(n => n.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<DocNode>().WithMany().HasForeignKey(n => n.ParentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(n => n.CreatedById).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(n => n.UpdatedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(n => new { n.ProjectId, n.Number }).IsUnique();
        builder.HasIndex(n => new { n.ProjectId, n.ParentId, n.Rank }).HasFilter("deleted_at IS NULL").HasDatabaseName("ix_doc_nodes_tree_rank");
        builder.HasIndex(n => new { n.ProjectId, n.UpdatedAt, n.Id }).IsDescending(false, true, true).HasFilter("deleted_at IS NULL")
            .HasDatabaseName("ix_doc_nodes_recent");
        builder.HasIndex(n => new { n.ProjectId, n.DeletedAt, n.Id }).IsDescending(false, true, true).HasFilter("deleted_at IS NOT NULL AND deleted_root_id = id")
            .HasDatabaseName("ix_doc_nodes_trash");
        builder.HasIndex(n => n.DeletedRootId).HasFilter("deleted_root_id IS NOT NULL");
        builder.HasIndex(n => n.ParentId).HasFilter("parent_id IS NOT NULL");
        builder.HasIndex(n => n.CreatedById);
        builder.HasIndex(n => n.UpdatedById);
        builder.HasIndex(n => n.Title).HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_doc_nodes_title_trgm");
        builder.HasIndex(DocSearch.VectorProperty).HasMethod("gin").HasDatabaseName("ix_doc_nodes_search_vector");
    }
}

internal sealed class DocVersionConfiguration : IEntityTypeConfiguration<DocVersion>
{
    public void Configure(EntityTypeBuilder<DocVersion> builder)
    {
        builder.HasKey(v => v.Id);
        builder.Property(v => v.Title).HasMaxLength(DocNode.TitleMaxLength);
        builder.Property(v => v.Content).UseCompressionMethod("lz4");
        builder.Property(v => v.ChangeNote).HasMaxLength(DocNode.ChangeNoteMaxLength);
        builder.HasOne<DocNode>().WithMany().HasForeignKey(v => v.NodeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(v => v.AuthorId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(v => new { v.NodeId, v.Number }).IsUnique();
        builder.HasIndex(v => v.AuthorId);
    }
}

internal sealed class DocDraftConfiguration : IEntityTypeConfiguration<DocDraft>
{
    public void Configure(EntityTypeBuilder<DocDraft> builder)
    {
        builder.HasKey(d => new { d.NodeId, d.UserId });
        builder.Property(d => d.Title).HasMaxLength(DocNode.TitleMaxLength);
        builder.Property(d => d.Content).UseCompressionMethod("lz4");
        builder.HasOne<DocNode>().WithMany().HasForeignKey(d => d.NodeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(d => d.UserId);
        builder.HasIndex(d => new { d.NodeId, d.UpdatedAt });
    }
}

internal sealed class DocReferenceConfiguration : IEntityTypeConfiguration<DocReference>
{
    public void Configure(EntityTypeBuilder<DocReference> builder)
    {
        builder.HasKey(r => new { r.SourceNodeId, r.TargetType, r.TargetId });
        builder.HasOne<DocNode>().WithMany().HasForeignKey(r => r.SourceNodeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(r => new { r.TargetType, r.TargetId });
    }
}
