using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using NpgsqlTypes;

#nullable disable

namespace Ticketing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,");

            migrationBuilder.CreateTable(
                name: "activity_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity_type = table.Column<int>(type: "integer", nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    channel = table.Column<int>(type: "integer", nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    field = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    old_value = table.Column<string>(type: "jsonb", nullable: true),
                    new_value = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_activity_entries", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    friendly_name = table.Column<string>(type: "text", nullable: true),
                    xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_data_protection_keys", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "feature_flags",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    rollout_percentage = table.Column<int>(type: "integer", nullable: false),
                    target_user_ids = table.Column<List<Guid>>(type: "uuid[]", nullable: false),
                    target_roles = table.Column<int[]>(type: "integer[]", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_feature_flags", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    display_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    global_role = table.Column<int>(type: "integer", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: true),
                    set_password_token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    set_password_token_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    failed_login_count = table.Column<int>(type: "integer", nullable: false),
                    locked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_login_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deactivated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deactivated_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "boards",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    archived_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_boards", x => x.id);
                    table.ForeignKey(
                        name: "fk_boards_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "idempotency_records",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    operation = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    request_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    result_json = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_idempotency_records", x => new { x.user_id, x.key });
                    table.ForeignKey(
                        name: "fk_idempotency_records_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "personal_access_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    scope = table.Column<int>(type: "integer", nullable: false),
                    prefix = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name_normalized = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true, computedColumnSql: "lower(name)", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_personal_access_tokens", x => x.id);
                    table.ForeignKey(
                        name: "fk_personal_access_tokens_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "projects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    visibility = table.Column<int>(type: "integer", nullable: false),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    archived_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    name_normalized = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true, computedColumnSql: "lower(name)", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_projects", x => x.id);
                    table.ForeignKey(
                        name: "fk_projects_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "board_projects",
                columns: table => new
                {
                    board_id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    added_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    added_by_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_board_projects", x => new { x.board_id, x.project_id });
                    table.ForeignKey(
                        name: "fk_board_projects_boards_board_id",
                        column: x => x.board_id,
                        principalTable: "boards",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_board_projects_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "project_counters",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    next_value = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_project_counters", x => new { x.project_id, x.kind });
                    table.ForeignKey(
                        name: "fk_project_counters_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_members",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<int>(type: "integer", nullable: false),
                    added_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    added_by_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_project_members", x => new { x.project_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_project_members_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_project_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "regression_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    version = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    status = table.Column<int>(type: "integer", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    cancelled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancelled_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_regression_sessions", x => x.id);
                    table.ForeignKey(
                        name: "fk_regression_sessions_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_regression_sessions_users_started_by_id",
                        column: x => x.started_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "tickets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    type = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    resolution = table.Column<int>(type: "integer", nullable: true),
                    priority = table.Column<int>(type: "integer", nullable: false),
                    severity = table.Column<int>(type: "integer", nullable: true),
                    story_points = table.Column<int>(type: "integer", nullable: true),
                    version = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    labels = table.Column<List<string>>(type: "text[]", nullable: false),
                    parent_id = table.Column<Guid>(type: "uuid", nullable: true),
                    board_id = table.Column<Guid>(type: "uuid", nullable: true),
                    rank = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false, collation: "C"),
                    assignee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reporter_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    status_changed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    search_vector = table.Column<NpgsqlTsVector>(type: "tsvector", nullable: true, computedColumnSql: "setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tickets", x => x.id);
                    table.ForeignKey(
                        name: "fk_tickets_boards_board_id",
                        column: x => x.board_id,
                        principalTable: "boards",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tickets_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tickets_tickets_parent_id",
                        column: x => x.parent_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tickets_users_assignee_id",
                        column: x => x.assignee_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tickets_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_tickets_users_reporter_id",
                        column: x => x.reporter_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "attachments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    ticket_id = table.Column<Guid>(type: "uuid", nullable: false),
                    file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    content_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    size_bytes = table.Column<int>(type: "integer", nullable: false),
                    sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    uploaded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    uploaded_by_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_attachments", x => x.id);
                    table.ForeignKey(
                        name: "fk_attachments_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_attachments_users_uploaded_by_id",
                        column: x => x.uploaded_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "comments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    ticket_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_id = table.Column<Guid>(type: "uuid", nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    edited_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deleted_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_comments", x => x.id);
                    table.ForeignKey(
                        name: "fk_comments_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_comments_users_author_id",
                        column: x => x.author_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "test_cases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    preconditions = table.Column<string>(type: "text", nullable: true),
                    steps = table.Column<List<string>>(type: "text[]", nullable: false),
                    expected_result = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<int>(type: "integer", nullable: false),
                    automation_reference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ticket_id = table.Column<Guid>(type: "uuid", nullable: true),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    archived_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_test_cases", x => x.id);
                    table.ForeignKey(
                        name: "fk_test_cases_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_test_cases_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ticket_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_ticket_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_ticket_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ticket_links", x => x.id);
                    table.ForeignKey(
                        name: "fk_ticket_links_tickets_source_ticket_id",
                        column: x => x.source_ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_ticket_links_tickets_target_ticket_id",
                        column: x => x.target_ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_ticket_links_users_created_by_id",
                        column: x => x.created_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "attachment_content",
                columns: table => new
                {
                    attachment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_attachment_content", x => x.attachment_id);
                    table.ForeignKey(
                        name: "fk_attachment_content_attachments_attachment_id",
                        column: x => x.attachment_id,
                        principalTable: "attachments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "regression_session_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    test_case_id = table.Column<Guid>(type: "uuid", nullable: false),
                    order = table.Column<int>(type: "integer", nullable: false),
                    test_case_key = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    preconditions = table.Column<string>(type: "text", nullable: true),
                    steps = table.Column<List<string>>(type: "text[]", nullable: false),
                    expected_result = table.Column<string>(type: "text", nullable: true),
                    automation_reference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    execution_mode = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<int>(type: "integer", nullable: false),
                    assignee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    result_note = table.Column<string>(type: "text", nullable: true),
                    executed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    executed_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    bug_ticket_id = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_regression_session_items", x => x.id);
                    table.ForeignKey(
                        name: "fk_regression_session_items_regression_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "regression_sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_regression_session_items_test_cases_test_case_id",
                        column: x => x.test_case_id,
                        principalTable: "test_cases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_regression_session_items_tickets_bug_ticket_id",
                        column: x => x.bug_ticket_id,
                        principalTable: "tickets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_regression_session_items_users_assignee_id",
                        column: x => x.assignee_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_activity_entries_actor_id_occurred_at",
                table: "activity_entries",
                columns: new[] { "actor_id", "occurred_at" },
                filter: "actor_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_activity_entries_entity_type_entity_id_occurred_at",
                table: "activity_entries",
                columns: new[] { "entity_type", "entity_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_activity_entries_occurred_at",
                table: "activity_entries",
                column: "occurred_at");

            migrationBuilder.CreateIndex(
                name: "ix_activity_entries_project_id_occurred_at",
                table: "activity_entries",
                columns: new[] { "project_id", "occurred_at" },
                filter: "project_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_attachments_ticket_id",
                table: "attachments",
                column: "ticket_id");

            migrationBuilder.CreateIndex(
                name: "ix_attachments_uploaded_by_id",
                table: "attachments",
                column: "uploaded_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_board_projects_project_id",
                table: "board_projects",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "ix_boards_name",
                table: "boards",
                column: "name",
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_boards_owner_id",
                table: "boards",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_comments_author_id",
                table: "comments",
                column: "author_id");

            migrationBuilder.CreateIndex(
                name: "ix_comments_ticket_id_created_at",
                table: "comments",
                columns: new[] { "ticket_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_feature_flags_key",
                table: "feature_flags",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_idempotency_records_expires_at",
                table: "idempotency_records",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_personal_access_tokens_token_hash",
                table: "personal_access_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_personal_access_tokens_user_id",
                table: "personal_access_tokens",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_personal_access_tokens_user_id_name_active",
                table: "personal_access_tokens",
                columns: new[] { "user_id", "name_normalized" },
                unique: true,
                filter: "revoked_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_project_members_user_id",
                table: "project_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_projects_created_by_id",
                table: "projects",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_projects_key",
                table: "projects",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_projects_name_active",
                table: "projects",
                column: "name_normalized",
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_regression_session_items_assignee_id_status",
                table: "regression_session_items",
                columns: new[] { "assignee_id", "status" },
                filter: "assignee_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_regression_session_items_bug_ticket_id",
                table: "regression_session_items",
                column: "bug_ticket_id",
                filter: "bug_ticket_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_regression_session_items_session_id_test_case_id",
                table: "regression_session_items",
                columns: new[] { "session_id", "test_case_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_regression_session_items_test_case_id",
                table: "regression_session_items",
                column: "test_case_id");

            migrationBuilder.CreateIndex(
                name: "ix_regression_sessions_project_id_number",
                table: "regression_sessions",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_regression_sessions_project_id_status_started_at",
                table: "regression_sessions",
                columns: new[] { "project_id", "status", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_regression_sessions_project_id_version",
                table: "regression_sessions",
                columns: new[] { "project_id", "version" },
                filter: "version IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_regression_sessions_started_by_id",
                table: "regression_sessions",
                column: "started_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_test_cases_project_id_number",
                table: "test_cases",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_test_cases_project_id_status",
                table: "test_cases",
                columns: new[] { "project_id", "status" },
                filter: "archived_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_test_cases_ticket_id",
                table: "test_cases",
                column: "ticket_id",
                filter: "ticket_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_test_cases_title_trgm",
                table: "test_cases",
                column: "title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_ticket_links_created_by_id",
                table: "ticket_links",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_ticket_links_source_ticket_id_target_ticket_id_type",
                table: "ticket_links",
                columns: new[] { "source_ticket_id", "target_ticket_id", "type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_ticket_links_target_ticket_id",
                table: "ticket_links",
                column: "target_ticket_id");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_assignee_id_status",
                table: "tickets",
                columns: new[] { "assignee_id", "status" },
                filter: "deleted_at IS NULL AND assignee_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_board_rank",
                table: "tickets",
                columns: new[] { "board_id", "rank" },
                filter: "board_id IS NOT NULL AND deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_container_rank",
                table: "tickets",
                columns: new[] { "project_id", "board_id", "rank" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_created_by_id",
                table: "tickets",
                column: "created_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_labels",
                table: "tickets",
                column: "labels")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_parent_id",
                table: "tickets",
                column: "parent_id",
                filter: "parent_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_created_at",
                table: "tickets",
                columns: new[] { "project_id", "created_at" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_number",
                table: "tickets",
                columns: new[] { "project_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_resolved_at",
                table: "tickets",
                columns: new[] { "project_id", "resolved_at" },
                filter: "deleted_at IS NULL AND resolved_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_status",
                table: "tickets",
                columns: new[] { "project_id", "status" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_type",
                table: "tickets",
                columns: new[] { "project_id", "type" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_updated_at",
                table: "tickets",
                columns: new[] { "project_id", "updated_at" },
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_project_id_version",
                table: "tickets",
                columns: new[] { "project_id", "version" },
                filter: "deleted_at IS NULL AND version IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_reporter_id",
                table: "tickets",
                column: "reporter_id");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_search_vector",
                table: "tickets",
                column: "search_vector")
                .Annotation("Npgsql:IndexMethod", "gin");

            migrationBuilder.CreateIndex(
                name: "ix_tickets_title_trgm",
                table: "tickets",
                column: "title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                table: "users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_users_set_password_token_hash",
                table: "users",
                column: "set_password_token_hash",
                unique: true,
                filter: "set_password_token_hash IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "activity_entries");

            migrationBuilder.DropTable(
                name: "attachment_content");

            migrationBuilder.DropTable(
                name: "board_projects");

            migrationBuilder.DropTable(
                name: "comments");

            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropTable(
                name: "feature_flags");

            migrationBuilder.DropTable(
                name: "idempotency_records");

            migrationBuilder.DropTable(
                name: "personal_access_tokens");

            migrationBuilder.DropTable(
                name: "project_counters");

            migrationBuilder.DropTable(
                name: "project_members");

            migrationBuilder.DropTable(
                name: "regression_session_items");

            migrationBuilder.DropTable(
                name: "ticket_links");

            migrationBuilder.DropTable(
                name: "attachments");

            migrationBuilder.DropTable(
                name: "regression_sessions");

            migrationBuilder.DropTable(
                name: "test_cases");

            migrationBuilder.DropTable(
                name: "tickets");

            migrationBuilder.DropTable(
                name: "boards");

            migrationBuilder.DropTable(
                name: "projects");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
