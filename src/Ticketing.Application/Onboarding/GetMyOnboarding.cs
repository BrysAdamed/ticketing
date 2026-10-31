using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Agents;
using Ticketing.Application.FeatureFlags;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Onboarding;

/// <summary>The caller's onboarding state: checklist, guide progress, project ownership and account age (D-132, D-135).</summary>
public static class GetMyOnboarding
{
    public sealed record Query;

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IFeatureFlags flags,
        IOptions<AgentOptions> agentOptions) : IHandler<Query, OnboardingDto>
    {
        public async Task<OnboardingDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var me = currentUser.Id;
            var isAdmin = currentUser.IsAdmin;
            var now = clock.Now;

            var projects = await access.ReadableProjects()
                .AsNoTracking()
                .Select(p => new
                {
                    p.Id,
                    Archived = p.ArchivedAt != null,
                    p.Visibility,
                    Membership = p.Members.Where(m => m.UserId == me).Select(m => (ProjectRole?)m.Role).FirstOrDefault(),
                    HasOthers = p.Members.Any(m => m.UserId != me),
                })
                .ToListAsync(cancellationToken);
            var readable = projects.Select(p => p.Id).ToList();
            var owned = projects.Where(p => !p.Archived && p.Membership == ProjectRole.Owner).ToList();
            var ownedIds = owned.Select(p => p.Id).ToList();
            var canWrite = projects.Any(p => !p.Archived
                && ProjectAccessPolicy.CanWrite(ProjectAccessPolicy.Effective(userIsActive: true, currentUser.Role, p.Visibility, p.Membership)));

            var row = await db.Users
                .AsNoTracking()
                .Where(u => u.Id == me)
                .Select(u => new ChecklistRow
                {
                    CreatedAt = u.CreatedAt,
                    CreatedTicket = db.Tickets.Any(t => t.ReporterId == me && t.DeletedAt == null && readable.Contains(t.ProjectId)),
                    StatusChanges = db.ActivityEntries.Count(a => a.ActorId == me
                        && a.Field == "status"
                        && a.Action == UpdateTicket.FieldChanged
                        && readable.Contains(a.ProjectId!.Value)),
                    CommentedOnTicket = db.Comments.Any(c => c.AuthorId == me && c.DeletedAt == null
                        && db.Tickets.Any(t => t.Id == c.TicketId && t.DeletedAt == null && readable.Contains(t.ProjectId))),
                    CommentedOnDoc = db.Comments.Any(c => c.AuthorId == me && c.DeletedAt == null
                        && db.DocNodes.Any(n => n.Id == c.DocNodeId && n.DeletedAt == null && readable.Contains(n.ProjectId))),
                    Watched = db.TicketWatchers.Any(w => w.UserId == me
                        && db.Tickets.Any(t => t.Id == w.TicketId && t.DeletedAt == null && readable.Contains(t.ProjectId))),
                    PlannedOnBoard = db.BoardProjects.Any(bp => ownedIds.Contains(bp.ProjectId) && db.Boards.Any(b => b.Id == bp.BoardId && b.DeletedAt == null)),
                    WroteTestCase = db.TestCases.Any(c => ownedIds.Contains(c.ProjectId)),
                    RanRegression = db.RegressionSessions.Any(s => ownedIds.Contains(s.ProjectId)),
                    AddedTeammate = isAdmin && db.Users.Any(other => other.CreatedById == me),
                    HasActiveToken = db.PersonalAccessTokens.Any(t => t.UserId == me && t.RevokedAt == null && t.ExpiresAt > now),
                    UsedToken = db.PersonalAccessTokens.Any(t => t.UserId == me && t.LastUsedAt != null),
                })
                .SingleAsync(cancellationToken);

            var guides = await db.UserGuideStates
                .AsNoTracking()
                .Where(s => s.UserId == me)
                .OrderBy(s => s.GuideId)
                .Select(s => new GuideStateDto(s.GuideId, s.Version, s.State, s.UpdatedAt))
                .ToListAsync(cancellationToken);

            var items = new List<OnboardingChecklistItemDto>();
            if (canWrite)
            {
                items.Add(new(OnboardingChecklistItems.CreateTicket, row.CreatedTicket, false));
                items.Add(new(OnboardingChecklistItems.MoveWork, row.StatusChanges > 0, false));
                items.Add(new(OnboardingChecklistItems.JoinConversation, row.CommentedOnTicket || row.CommentedOnDoc, false));
            }
            items.Add(new(OnboardingChecklistItems.FollowTicket, row.Watched, false));
            if (owned.Count > 0)
            {
                items.Add(new(OnboardingChecklistItems.InviteTeam, owned.Any(p => p.Visibility == ProjectVisibility.Public || p.HasOthers), false));
                items.Add(new(OnboardingChecklistItems.PlanOnBoard, row.PlannedOnBoard, false));
                items.Add(new(OnboardingChecklistItems.WriteTestCase, row.WroteTestCase, false));
                items.Add(new(OnboardingChecklistItems.RunRegression, row.RanRegression, false));
            }
            if (isAdmin)
            {
                items.Add(new(OnboardingChecklistItems.AddTeammate, row.AddedTeammate, false));
                items.Add(new(OnboardingChecklistItems.FirstProject, projects.Count > 0, false));
                if (await flags.IsOnAsync(FeatureFlagCatalog.AgentDelegate, cancellationToken))
                    items.Add(new(OnboardingChecklistItems.EnableDelegation, agentOptions.Value.InstanceUrl is not null, false));
            }
            items.Add(new(OnboardingChecklistItems.AgentToken, row.HasActiveToken, true));
            items.Add(new(OnboardingChecklistItems.AgentConnected, row.UsedToken, true));

            return new OnboardingDto(items, guides, owned.Count > 0, row.CreatedAt);
        }
    }

    private sealed class ChecklistRow
    {
        public DateTimeOffset CreatedAt { get; init; }

        public bool CreatedTicket { get; init; }

        public int StatusChanges { get; init; }

        public bool CommentedOnTicket { get; init; }

        public bool CommentedOnDoc { get; init; }

        public bool Watched { get; init; }

        public bool PlannedOnBoard { get; init; }

        public bool WroteTestCase { get; init; }

        public bool RanRegression { get; init; }

        public bool AddedTeammate { get; init; }

        public bool HasActiveToken { get; init; }

        public bool UsedToken { get; init; }
    }
}
