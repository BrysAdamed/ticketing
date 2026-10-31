using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDocWatchers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "doc_watchers",
                columns: table => new
                {
                    doc_node_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_doc_watchers", x => new { x.doc_node_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_doc_watchers_doc_nodes_doc_node_id",
                        column: x => x.doc_node_id,
                        principalTable: "doc_nodes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_doc_watchers_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_doc_watchers_user_id_doc_node_id",
                table: "doc_watchers",
                columns: new[] { "user_id", "doc_node_id" });

            migrationBuilder.Sql("""
                INSERT INTO doc_watchers (doc_node_id, user_id, created_at)
                SELECT n.id, n.created_by_id, n.created_at FROM doc_nodes n WHERE n.kind <> 1
                UNION
                SELECT c.doc_node_id, c.author_id, min(c.created_at) FROM comments c
                WHERE c.doc_node_id IS NOT NULL AND c.deleted_at IS NULL
                GROUP BY c.doc_node_id, c.author_id
                ON CONFLICT DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "doc_watchers");
        }
    }
}
