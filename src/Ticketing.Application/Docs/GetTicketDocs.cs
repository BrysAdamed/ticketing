using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// "Docs mentioning this ticket" (spec 1.9): readable, non-deleted docs whose latest content mentions the ticket, newest first,
/// with the total for "and N more". Docs of projects the caller cannot read are neither listed nor counted.
/// </summary>
public static class GetTicketDocs
{
    public const int DefaultLimit = 20;
    public const int MaxLimit = 100;

    public sealed record Query(string TicketKeyOrId, int? Limit = null) : IValidatable
    {
        public void Validate(Validator validator) => validator.Range("limit", Limit, 1, MaxLimit);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, DocMentionsDto>
    {
        public async Task<DocMentionsDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var ticket = await TicketLookup.ReadAsync(db, access, request.TicketKeyOrId, cancellationToken);
            return await LoadAsync(db, access, ticket.Id, request.Limit ?? DefaultLimit, cancellationToken);
        }

        internal static Task<DocMentionsDto> LoadAsync(ITicketingDbContext db, IProjectAccess access, Guid ticketId, int limit, CancellationToken cancellationToken) =>
            DocReferenceQueries.MentioningAsync(db, access, DocReferenceTarget.Ticket, ticketId, limit, cancellationToken);
    }
}
