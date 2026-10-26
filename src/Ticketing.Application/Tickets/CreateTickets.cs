using System.Globalization;
using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Creates 1..50 tickets in one project, all or nothing (I-26). An item's <c>parentKey</c> may reference an earlier item of
/// the same batch as <c>#index</c> (zero-based). Errors name the failing item (<c>tickets[3].title</c>).
/// </summary>
public static class CreateTickets
{
    public const int MaxItems = 50;

    public sealed record Command(
        IReadOnlyList<CreateTicket.Command> Tickets,
        [property: JsonIgnore] string ProjectKeyOrId = "",
        [property: JsonIgnore] string? IdempotencyKey = null) : IValidatable
    {
        public void Validate(Validator validator)
        {
            if (Tickets is null || Tickets.Count is 0 or > MaxItems)
            {
                validator.Add("tickets", $"Send 1..{MaxItems} tickets.");
                return;
            }
            for (var i = 0; i < Tickets.Count; i++)
            {
                Tickets[i].Validate(validator, Prefix(i));
                if (TryBatchIndex(Tickets[i].ParentKey, out var parentIndex) && (parentIndex < 0 || parentIndex >= i))
                    validator.Add(Prefix(i) + "parentKey", "A #index parent must reference an earlier ticket of the batch.");
            }
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        IIdempotency idempotency,
        CreateTicket.Handler create) : IHandler<Command, IReadOnlyList<TicketSummaryDto>>
    {
        public async Task<IReadOnlyList<TicketSummaryDto>> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureCanWriteAsync(command.ProjectKeyOrId, cancellationToken);
            return await idempotency.ExecuteAsync(
                command.IdempotencyKey, "tickets.createBatch", command with { IdempotencyKey = null, ProjectKeyOrId = grant.ProjectId.ToString() },
                ct => db.InTransactionAsync(ict => CreateAllAsync(grant, command.Tickets, ict), ct),
                cancellationToken);
        }

        private async Task<IReadOnlyList<TicketSummaryDto>> CreateAllAsync(
            ProjectAccessGrant grant, IReadOnlyList<CreateTicket.Command> items, CancellationToken cancellationToken)
        {
            var ids = new List<Guid>(items.Count);
            for (var i = 0; i < items.Count; i++)
            {
                var item = items[i] with { ProjectKeyOrId = grant.ProjectId.ToString(), IdempotencyKey = null };
                try
                {
                    Guid? parentId = item.ParentKey switch
                    {
                        null => null,
                        var key when TryBatchIndex(key, out var index) => ids[index],
                        var key => await create.ParentAsync(key, cancellationToken),
                    };
                    ids.Add((await create.CreateAsync(grant, item, parentId, cancellationToken)).Id);
                }
                catch (Exception ex) when (ex is AppException or DomainException)
                {
                    throw ForItem(i, ex is DomainException domain ? AppException.From(domain) : (AppException)ex);
                }
            }
            return await TicketQueries.SummariesAsync(db, ids, cancellationToken);
        }
    }

    private static string Prefix(int index) => string.Create(CultureInfo.InvariantCulture, $"tickets[{index}].");

    private static bool TryBatchIndex(string? parentKey, out int index)
    {
        index = -1;
        return parentKey is not null
            && parentKey.StartsWith('#')
            && int.TryParse(parentKey.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out index);
    }

    private static AppException ForItem(int index, AppException error) =>
        new(
            error.Kind,
            error.Code,
            string.Create(CultureInfo.InvariantCulture, $"Ticket #{index}: {error.Message}"),
            error.Hint,
            error.Errors.ToDictionary(e => Prefix(index) + e.Key, e => e.Value, StringComparer.Ordinal));
}
