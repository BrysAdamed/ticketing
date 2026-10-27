using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NpgsqlTypes;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDocs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "ticket_id",
                table: "attachments",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "doc_node_id",
                table: "attachments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "doc_nodes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    diagram_format = table.Column<int>(type: "integer", nullable: true),
                    parent_id = table.Column<Guid>(type: "uuid", nullable: true),
                    rank = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false, collation: "C"),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content = table.Column<string>(type: "text", nullable: true)
                        .Annotation("Npgsql:Compression:", "lz4"),
                    outline = table.Column<string>(type: "text", nullable: true)
                        .Annotation("Npgsql:Compression:", "lz4"),
                    current_version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    deleted_root_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    search_vector = table.Column<NpgsqlTsVector>(type: "tsvector", nullable: true, computedColumnSql: "setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, CASE WHEN diagram_format = 2 THEN coalesce(outline, '') ELSE coalesce(content, '') END), 'B')", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_doc_nodes", x => x.id);
                    table.CheckConstraint("ck_doc_nodes_diagram_format", "(kind = 3) = (diagram_format IS NOT NULL)");
                    table.ForeignKey(
                        name: "fk_doc_nodes_doc_nodes_parent_id",
                        column: x => x.parent_id,
                        principalTable: "doc_nodes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_doc_nodes_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_doc_nodes_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_doc_nodes_users_updated_by_id",
                        column: x => x.updated_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "doc_drafts",
                columns: table => new
                {
                    node_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    base_version = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false)
                        .Annotation("Npgsql:Compression:", "lz4"),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_doc_drafts", x => new { x.node_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_doc_drafts_doc_nodes_node_id",
                        column: x => x.node_id,
                        principalTable: "doc_nodes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_doc_drafts_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "doc_references",
                columns: table => new
                {
                    source_node_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_type = table.Column<int>(type: "integer", nullable: false),
                    target_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_doc_references", x => new { x.source_node_id, x.target_type, x.target_id });
                    table.ForeignKey(
                        name: "fk_doc_references_doc_nodes_source_node_id",
                        column: x => x.source_node_id,
                        principalTable: "doc_nodes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "doc_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    node_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false)
                        .Annotation("Npgsql:Compression:", "lz4"),
                    change_note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    author_id = table.Column<Guid>(type: "uuid", nullable: false),
                    channel = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    restored_from = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_doc_versions", x => x.id);
                    table.ForeignKey(
                        name: "fk_doc_versions_doc_nodes_node_id",
                        column: x => x.node_id,
                        principalTable: "doc_nodes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_doc_versions_users_author_id",
                        column: x => x.author_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_attachments_doc_node_id",
                table: "attachments",
                column: "doc_node_id",
                filter: "doc_node_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_attachments_owner",
                table: "attachments",
                sql: "num_nonnulls(ticket_id, doc_node_id) = 1");

            migrationBuilder.CreateIndex(
                name: "ix_doc_drafts_node_id_updated_at",
                table: "doc_drafts",
                columns: new[] { "node_id", "updated_at" });

            migrationBuilder.CreateIndex(
                name: "ix_doc_drafts_user_id",
                table: "doc_drafts",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_created_by_id",
                table: "doc_nodes",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_deleted_root_id",
                table: "doc_nodes",
                column: "deleted_root_id",
                filter: "deleted_root_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_parent_id",
                table: "doc_nodes",
                column: "parent_id",
                filter: "parent_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_project_id_number",
                table: "doc_nodes",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_recent",
                table: "doc_nodes",
                columns: new[] { "project_id", "updated_at", "id" },
                descending: new[] { false, true, true },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_search_vector",
                table: "doc_nodes",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_title_trgm",
                table: "doc_nodes",
                column: "title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_trash",
                table: "doc_nodes",
                columns: new[] { "project_id", "deleted_at", "id" },
                descending: new[] { false, true, true },
                filter: "deleted_at IS NOT NULL AND deleted_root_id = id");

            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_tree_rank",
                table: "doc_nodes",
                columns: new[] { "project_id", "parent_id", "rank" },
                filter: "deleted_at IS NULL");

            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ux_doc_nodes_sibling_title ON doc_nodes (project_id, parent_id, lower(title)) NULLS NOT DISTINCT WHERE deleted_at IS NULL;");
            migrationBuilder.CreateIndex(
                name: "ix_doc_nodes_updated_by_id",
                table: "doc_nodes",
                column: "updated_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_doc_references_target_type_target_id",
                table: "doc_references",
                columns: new[] { "target_type", "target_id" });

            migrationBuilder.CreateIndex(
                name: "ix_doc_versions_author_id",
                table: "doc_versions",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_doc_versions_node_id_number",
                table: "doc_versions",
                columns: new[] { "node_id", "number" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_attachments_doc_nodes_doc_node_id",
                table: "attachments",
                column: "doc_node_id",
                principalTable: "doc_nodes",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_attachments_doc_nodes_doc_node_id",
                table: "attachments");

            migrationBuilder.DropTable(
                name: "doc_drafts");

            migrationBuilder.DropTable(
                name: "doc_references");

            migrationBuilder.DropTable(
                name: "doc_versions");

            migrationBuilder.DropTable(
                name: "doc_nodes");

            migrationBuilder.DropIndex(
                name: "ix_attachments_doc_node_id",
                table: "attachments");

            migrationBuilder.DropCheckConstraint(
                name: "ck_attachments_owner",
                table: "attachments");

            migrationBuilder.DropColumn(
                name: "doc_node_id",
                table: "attachments");

            migrationBuilder.AlterColumn<Guid>(
                name: "ticket_id",
                table: "attachments",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
