using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.TestCases;

namespace Ticketing.Application.TestCases;

/// <summary>Hard-deletes a test case that never appeared in a regression session (Owner only, spec 6.10). Used cases can only be archived.</summary>
public static class DeleteTestCase
{
    public sealed record Command(string KeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, IActivityLog activity) : IHandler<Command, bool>
    {
        public async Task<bool> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            var target = await TestCaseLookup.OwnerAsync(db, access, command.KeyOrId, cancellationToken);
            var id = target.Id;
            if (await db.RegressionSessionItems.AnyAsync(i => i.TestCaseId == id, cancellationToken))
                throw UsedInSession(target.Key);

            var testCase = await db.TestCases.SingleAsync(c => c.Id == id, cancellationToken);
            db.TestCases.Remove(testCase);
            activity.Record(ActivityEntityType.TestCase, id, target.ProjectId, "testCase.deleted", new { key = target.Key, testCase.Title });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex.IsForeignKeyViolation())
            {
                throw UsedInSession(target.Key);
            }
            return true;
        }

        private static DomainException UsedInSession(string key) =>
            DomainException.Conflict(TestCaseErrors.UsedInSession, $"{key} was used in a regression session and can only be archived.", "Archive the test case instead.");
    }
}
