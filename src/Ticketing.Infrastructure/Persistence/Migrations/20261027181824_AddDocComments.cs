using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDocComments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "doc_node_id",
                table: "notifications",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ticket_id",
                table: "comments",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "doc_node_id",
                table: "comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_notifications_doc_node_id",
                table: "notifications",
                column: "doc_node_id",
                filter: "doc_node_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_comments_doc_node_id_created_at",
                table: "comments",
                columns: new[] { "doc_node_id", "created_at" },
                filter: "doc_node_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_comments_owner",
                table: "comments",
                sql: "num_nonnulls(ticket_id, doc_node_id) = 1");

            migrationBuilder.AddForeignKey(
                name: "fk_comments_doc_nodes_doc_node_id",
                table: "comments",
                column: "doc_node_id",
                principalTable: "doc_nodes",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_notifications_doc_nodes_doc_node_id",
                table: "notifications",
                column: "doc_node_id",
                principalTable: "doc_nodes",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_comments_doc_nodes_doc_node_id",
                table: "comments");

            migrationBuilder.DropForeignKey(
                name: "fk_notifications_doc_nodes_doc_node_id",
                table: "notifications");

            migrationBuilder.DropIndex(
                name: "ix_notifications_doc_node_id",
                table: "notifications");

            migrationBuilder.DropIndex(
                name: "ix_comments_doc_node_id_created_at",
                table: "comments");

            migrationBuilder.DropCheckConstraint(
                name: "ck_comments_owner",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "doc_node_id",
                table: "notifications");

            migrationBuilder.DropColumn(
                name: "doc_node_id",
                table: "comments");

            migrationBuilder.AlterColumn<Guid>(
                name: "ticket_id",
                table: "comments",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
