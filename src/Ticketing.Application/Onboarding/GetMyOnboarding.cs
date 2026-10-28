using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Onboarding;

/// <summary>The caller's onboarding state: checklist, guide progress, project ownership and account age (D-130).</summary>
public static class GetMyOnboarding
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, OnboardingDto>
    {
        public async Task<OnboardingDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var me = currentUser.Id;
            var createdAt = await db.Users.AsNoTracking().Where(u => u.Id == me).Select(u => u.CreatedAt).SingleAsync(cancellationToken);
            var guides = await db.UserGuideStates
                .AsNoTracking()
                .Where(s => s.UserId == me)
                .OrderBy(s => s.GuideId)
                .Select(s => new GuideStateDto(s.GuideId, s.Version, s.State, s.UpdatedAt))
                .ToListAsync(cancellationToken);
            var ownsProjects = await access.ReadableProjects()
                .AnyAsync(p => p.ArchivedAt == null && p.Members.Any(m => m.UserId == me && m.Role == ProjectRole.Owner), cancellationToken);

            return new OnboardingDto([], guides, ownsProjects, createdAt);
        }
    }
}
