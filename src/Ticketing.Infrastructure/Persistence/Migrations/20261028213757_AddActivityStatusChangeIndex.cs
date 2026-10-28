using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddActivityStatusChangeIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_activity_entries_actor_status_changes",
                table: "activity_entries",
                columns: new[] { "actor_id", "project_id" },
                filter: "field = 'status' AND action = 'ticket.field.changed'");

            migrationBuilder.Sql("CREATE STATISTICS IF NOT EXISTS st_activity_entries_actor_field (mcv) ON actor_id, field FROM activity_entries;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP STATISTICS IF EXISTS st_activity_entries_actor_field;");

            migrationBuilder.DropIndex(
                name: "ix_activity_entries_actor_status_changes",
                table: "activity_entries");
        }
    }
}
