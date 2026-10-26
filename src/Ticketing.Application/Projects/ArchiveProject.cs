using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>
/// Archives a project (Owner only, spec 4.3): its tickets on boards return to the backlog top, keeping their relative
/// order (board by board, oldest board first, then board rank; D-52), the project is unlinked from every board, and the
/// project becomes read-only.
/// </summary>
public static class ArchiveProject
{
    public sealed record Command(string ProjectKeyOrId);

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        ITicketRanker ranker,
        IActivityLog activity) : IHandler<Command, ProjectDto>
    {
        public async Task<ProjectDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureOwnerAsync(command.ProjectKeyOrId, cancellationToken);

            return await db.InTransactionAsync(async ct =>
            {
                var project = await ProjectMembership.LockAndLoadAsync(db, grant.ProjectId, ct);
                project.Archive(currentUser.Id, clock.Now);

                var returned = await ReturnBoardTicketsToBacklogAsync(project.Id, ct);
                var unlinkedBoards = await UnlinkFromBoardsAsync(project, ct);

                activity.Record(ActivityEntityType.Project, project.Id, project.Id, "project.archived",
                    new { ticketsReturnedToBacklog = returned, boardsUnlinked = unlinkedBoards });
                await db.SaveChangesAsync(ct);
                return await GetProject.Handler.LoadAsync(db, grant with { IsArchived = true }, ct);
            }, cancellationToken);
        }

        private async Task<int> ReturnBoardTicketsToBacklogAsync(Guid projectId, CancellationToken cancellationToken)
        {
            var tickets = await db.Tickets
                .Where(t => t.ProjectId == projectId && t.BoardId != null && t.DeletedAt == null)
                .Join(db.Boards, t => t.BoardId, b => b.Id, (t, b) => new { Ticket = t, BoardCreatedAt = b.CreatedAt })
                .OrderBy(x => x.BoardCreatedAt).ThenBy(x => x.Ticket.BoardId).ThenBy(x => x.Ticket.Rank).ThenBy(x => x.Ticket.Id)
                .Select(x => x.Ticket)
                .ToListAsync(cancellationToken);
            if (tickets.Count == 0)
                return 0;

            var ranks = await ranker.TopManyAsync(RankContainer.Backlog(projectId), tickets.Count, [.. tickets.Select(t => t.Id)], cancellationToken);
            for (var i = 0; i < tickets.Count; i++)
            {
                var ticket = tickets[i];
                var fromBoard = ticket.BoardId;
                ticket.MoveToBacklog(ranks[i]);
                ticket.Touch(clock.Now);
                activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, projectId, "ticket.moved", "boardId", fromBoard, (Guid?)null);
            }
            return tickets.Count;
        }

        private async Task<int> UnlinkFromBoardsAsync(Project project, CancellationToken cancellationToken)
        {
            var links = await db.BoardProjects.Where(bp => bp.ProjectId == project.Id).ToListAsync(cancellationToken);
            foreach (var link in links)
                activity.Record(ActivityEntityType.Board, link.BoardId, project.Id, "board.project.unlinked", new { projectId = project.Id, projectKey = project.Key });
            db.BoardProjects.RemoveRange(links);
            return links.Count;
        }
    }
}
