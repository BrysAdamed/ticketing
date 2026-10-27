using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Stores the SVG picture of a Canvas version that has none yet (D-110): versions written over MCP get one when a writer
/// opens the diagram and the browser exports it. Creates no version and no activity; the first picture stored wins, later
/// ones are ignored (<see cref="Result.Stored"/> false).
/// </summary>
public static class StoreDocSnapshot
{
    public sealed record Command(string Svg) : IValidatable
    {
        [JsonIgnore]
        public string KeyOrId { get; init; } = string.Empty;

        [JsonIgnore]
        public int Number { get; init; }

        public void Validate(Validator validator) => validator.Must(!string.IsNullOrWhiteSpace(Svg), "svg", "svg is required.");
    }

    public sealed record Result(string DocKey, int Version, bool Stored, string SnapshotUrl);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, DocPublisher publisher) : IHandler<Command, Result>
    {
        public async Task<Result> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            var nodeId = target.Id;
            var number = command.Number;
            var format = await db.DocNodes.AsNoTracking().Where(n => n.Id == nodeId).Select(n => n.DiagramFormat).SingleAsync(cancellationToken);
            if (format != DiagramFormat.Canvas)
                throw AppException.Conflict(DocErrors.KindUnsupported, $"{target.Key} is not a Canvas diagram; only Canvas diagrams have a snapshot.");
            if (!await db.DocVersions.AnyAsync(v => v.NodeId == nodeId && v.Number == number, cancellationToken))
                throw AppException.NotFound(
                    DocErrors.VersionNotFound, string.Create(CultureInfo.InvariantCulture, $"{target.Key} has no version {number}."));

            var stored = await publisher.AttachSnapshotAsync(nodeId, number, command.Svg, cancellationToken);
            return new Result(target.Key, number, stored, DocQueries.SnapshotUrl(target.Key, number));
        }
    }
}
