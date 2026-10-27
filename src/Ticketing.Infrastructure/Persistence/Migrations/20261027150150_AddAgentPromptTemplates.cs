using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAgentPromptTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "agent_delegation_enabled",
                table: "projects",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "agent_merge_policy",
                table: "projects",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "repository_url",
                table: "projects",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "agent_prompt_templates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    scope = table.Column<int>(type: "integer", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    ticket_type = table.Column<int>(type: "integer", nullable: true),
                    mode = table.Column<int>(type: "integer", nullable: false),
                    body = table.Column<string>(type: "character varying(4500)", maxLength: 4500, nullable: true),
                    current_version = table.Column<int>(type: "integer", nullable: false),
                    based_on_default_version = table.Column<int>(type: "integer", nullable: true),
                    built_in_version = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    follows_built_in = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_agent_prompt_templates", x => x.id);
                    table.CheckConstraint("ck_agent_prompt_templates_scope", "(scope = 1 AND project_id IS NULL) OR (scope = 2 AND project_id IS NOT NULL AND ticket_type IS NOT NULL)");
                    table.ForeignKey(
                        name: "fk_agent_prompt_templates_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_agent_prompt_templates_users_updated_by_id",
                        column: x => x.updated_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "agent_prompt_template_versions",
                columns: table => new
                {
                    template_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    mode = table.Column<int>(type: "integer", nullable: false),
                    body = table.Column<string>(type: "character varying(4500)", maxLength: 4500, nullable: true),
                    built_in_version = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    change_note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    author_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    restored_from = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_agent_prompt_template_versions", x => new { x.template_id, x.number });
                    table.ForeignKey(
                        name: "fk_agent_prompt_template_versions_agent_prompt_templates_templ",
                        column: x => x.template_id,
                        principalTable: "agent_prompt_templates",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_agent_prompt_template_versions_users_author_id",
                        column: x => x.author_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_agent_prompt_template_versions_author_id",
                table: "agent_prompt_template_versions",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_agent_prompt_templates_project_id",
                table: "agent_prompt_templates",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_agent_prompt_templates_scope_project_id_ticket_type",
                table: "agent_prompt_templates",
                columns: new[] { "scope", "project_id", "ticket_type" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_agent_prompt_templates_updated_by_id",
                table: "agent_prompt_templates",
                column: "updated_by_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_prompt_template_versions");

            migrationBuilder.DropTable(
                name: "agent_prompt_templates");

            migrationBuilder.DropColumn(
                name: "agent_delegation_enabled",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "agent_merge_policy",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "repository_url",
                table: "projects");
        }
    }
}
