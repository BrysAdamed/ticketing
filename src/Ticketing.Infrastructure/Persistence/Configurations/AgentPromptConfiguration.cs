using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal sealed class AgentPromptTemplateConfiguration : IEntityTypeConfiguration<AgentPromptTemplate>
{
    public void Configure(EntityTypeBuilder<AgentPromptTemplate> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Body).HasMaxLength(AgentPromptTemplate.BodyMaxLength);
        builder.Property(t => t.BuiltInVersion).HasMaxLength(BuiltInPrompt.VersionMaxLength);
        builder.Property(t => t.RowVersion).IsXminRowVersion();
        builder.Ignore(t => t.Slot);
        builder.ToTable(t => t.HasCheckConstraint(
            "ck_agent_prompt_templates_scope",
            "(scope = 1 AND project_id IS NULL) OR (scope = 2 AND project_id IS NOT NULL AND ticket_type IS NOT NULL)"));

        builder.HasOne<Project>().WithMany().HasForeignKey(t => t.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.UpdatedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(t => new { t.Scope, t.ProjectId, t.TicketType }).IsUnique().AreNullsDistinct(false);
    }
}

internal sealed class AgentPromptTemplateVersionConfiguration : IEntityTypeConfiguration<AgentPromptTemplateVersion>
{
    public void Configure(EntityTypeBuilder<AgentPromptTemplateVersion> builder)
    {
        builder.HasKey(v => new { v.TemplateId, v.Number });
        builder.Property(v => v.Body).HasMaxLength(AgentPromptTemplate.BodyMaxLength);
        builder.Property(v => v.BuiltInVersion).HasMaxLength(BuiltInPrompt.VersionMaxLength);
        builder.Property(v => v.ChangeNote).HasMaxLength(AgentPromptTemplate.ChangeNoteMaxLength);

        builder.HasOne<AgentPromptTemplate>().WithMany().HasForeignKey(v => v.TemplateId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(v => v.AuthorId).OnDelete(DeleteBehavior.Restrict);
    }
}
