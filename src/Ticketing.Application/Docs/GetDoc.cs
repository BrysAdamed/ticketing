using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;

namespace Ticketing.Application.Docs;

/// <summary>
/// A doc by key (or id), or by project and path: latest content, path and breadcrumb, who else is editing, the caller's
/// own draft marker and permissions; folders also list their children. With <c>Version</c> the content is that version's
/// and <see cref="DocDto.AtVersion"/> describes it.
/// </summary>
public static class GetDoc
{
    /// <param name="KeyOrId">A doc key such as <c>WEB-D-12</c> or an id; otherwise give <paramref name="ProjectKeyOrId"/> and <paramref name="Path"/>.</param>
    public sealed record Query(string? KeyOrId, string? ProjectKeyOrId = null, string? Path = null, int? Version = null) : IValidatable
    {
        public void Validate(Validator validator) =>
            validator.Must(
                !string.IsNullOrWhiteSpace(KeyOrId) || (!string.IsNullOrWhiteSpace(ProjectKeyOrId) && !string.IsNullOrWhiteSpace(Path)),
                "docKey", "Give a doc key, or a project key and a path.");
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock) : IHandler<Query, DocDto>
    {
        public async Task<DocDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var target = string.IsNullOrWhiteSpace(request.KeyOrId)
                ? await DocLookup.ReadByPathAsync(db, access, request.ProjectKeyOrId!, request.Path!, cancellationToken)
                : await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            var doc = await DocQueries.LoadAsync(db, access, currentUser, clock, target, cancellationToken);
            if (request.Version is not { } number)
                return doc;
            var version = await GetDocVersion.LoadAsync(db, target, number, cancellationToken);
            return doc with
            {
                Content = version.Content,
                AtVersion = new DocVersionInfoDto(
                    version.Number, version.Title, version.ChangeNote, version.Author, version.Channel, version.CreatedAt, version.RestoredFrom),
            };
        }
    }
}
