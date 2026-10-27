using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDocVersionLineCounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "lines_added",
                table: "doc_versions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "lines_removed",
                table: "doc_versions",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "lines_added",
                table: "doc_versions");

            migrationBuilder.DropColumn(
                name: "lines_removed",
                table: "doc_versions");
        }
    }
}
