using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <param name="Url">Server-relative <c>GET</c> URL of the PDF; it needs no other credentials until <paramref name="ExpiresAt"/>.</param>
public sealed record DocExportLinkDto(string DocKey, int? Version, string Url, DateTimeOffset ExpiresAt);

/// <summary>
/// A signed link to a doc's PDF (MCP <c>get_doc_export_link</c>): valid 15 minutes, bound to the caller and the doc. On use the
/// export runs as the caller, so access is checked again; an expired link, a link of a deactivated user or one used for
/// another doc answers 404.
/// </summary>
public static class CreateDocExportLink
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    public sealed record Command(string KeyOrId, int? Version = null) : IValidatable
    {
        public void Validate(Validator validator) =>
            validator.Must(Version is null or >= 1, "version", "Versions start at 1.");
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IDocExportLinks links)
        : IHandler<Command, DocExportLinkDto>
    {
        public async Task<DocExportLinkDto> HandleAsync(Command request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var target = await DocLookup.ReadAsync(db, access, request.KeyOrId, cancellationToken);
            if (request.Version is { } number)
            {
                if (target.Kind == DocKind.Folder)
                    throw AppException.Invalid("version", "Folders have no versions; export a folder without version.");
                await GetDocVersion.LoadAsync(db, target, number, cancellationToken);
            }
            var me = currentUser.Id;
            var stamp = await db.Users.AsNoTracking().Where(u => u.Id == me).Select(u => u.SecurityStamp).SingleAsync(cancellationToken);
            var expiresAt = clock.Now + Lifetime;
            var token = links.Create(new DocExportGrant(me, target.Id, request.Version, stamp), expiresAt);
            var url = string.Create(CultureInfo.InvariantCulture, $"/api/v1/docs/{target.Key}/export.pdf?token={Uri.EscapeDataString(token)}");
            return new DocExportLinkDto(target.Key, request.Version, url, expiresAt);
        }
    }
}
