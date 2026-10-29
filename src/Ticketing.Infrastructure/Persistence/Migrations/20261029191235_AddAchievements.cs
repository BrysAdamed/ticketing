using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAchievements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "achievements_hidden",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "achievements_started_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "achievement_projector_state",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    processed_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_achievement_projector_state", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "user_achievements",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    achievement_id = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    tier = table.Column<short>(type: "smallint", nullable: false),
                    unlocked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_achievements", x => new { x.user_id, x.achievement_id, x.tier });
                    table.ForeignKey(
                        name: "fk_user_achievements_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_activity_entries_actor_action",
                table: "activity_entries",
                columns: new[] { "actor_id", "action", "field", "occurred_at" },
                filter: "actor_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "achievement_projector_state");

            migrationBuilder.DropTable(
                name: "user_achievements");

            migrationBuilder.DropIndex(
                name: "ix_activity_entries_actor_action",
                table: "activity_entries");

            migrationBuilder.DropColumn(
                name: "achievements_hidden",
                table: "users");

            migrationBuilder.DropColumn(
                name: "achievements_started_at",
                table: "users");
        }
    }
}
