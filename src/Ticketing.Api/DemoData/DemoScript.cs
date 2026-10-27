using Ticketing.Application.FeatureFlags;
using Ticketing.Application.Regressions;
using Ticketing.Application.TestCases;
using Ticketing.Application.Tickets;
using Ticketing.Application.Users;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.DemoData;

/// <summary>
/// Plans the demo workspace's twelve-week history from <see cref="DemoContent"/> with a fixed random seed, then replays
/// it in time order through <see cref="DemoWorkspace"/>: every ticket, transition, comment, link, board move and
/// regression result is a real use case call made by a demo user at a backdated time.
/// </summary>
internal sealed partial class DemoScript(DemoWorkspace workspace, DemoActor admin, DateTimeOffset now, string? password, ILogger logger)
{
    public const int RandomSeed = 20261027;
    private const double HistoryDays = 84;

    private static readonly TicketStatus[] Flow =
        [TicketStatus.InProgress, TicketStatus.Review, TicketStatus.ReadyForTesting, TicketStatus.Testing, TicketStatus.ReadyForDeploy];

    /// <summary>Statuses of open tickets, drawn like cards so that every status shows up in proportion.</summary>
    private static readonly (TicketStatus Status, int Copies)[] OpenStatusDeck =
    [
        (TicketStatus.ToDo, 10), (TicketStatus.InProgress, 4), (TicketStatus.Review, 3), (TicketStatus.ReadyForTesting, 2),
        (TicketStatus.Testing, 2), (TicketStatus.ReadyForDeploy, 2), (TicketStatus.OnHold, 2),
    ];

    private readonly Random _random = new(RandomSeed);
    private readonly List<TicketStatus> _openStatuses = [];
    private readonly Dictionary<string, DemoActor> _users = new(StringComparer.Ordinal);
    private readonly List<DemoActor> _createdUsers = [];
    private readonly List<PlannedTicket> _tickets = [];
    private readonly Dictionary<string, PlannedTicket> _byTitle = new(StringComparer.Ordinal);
    private readonly HashSet<(PlannedTicket, PlannedTicket)> _linked = [];
    private readonly Dictionary<string, string> _testCaseKeys = new(StringComparer.Ordinal);
    private readonly List<Step> _timeline = [];
    private readonly PlannedBoard _sprint = new(
        "Sprint 42", "Payments and Web App, sprint 42: BLIK launch readiness, checkout redesign and refund fixes.", ["PAY", "WEB"], "maya");
    private readonly PlannedBoard _kanban = new("Ops Kanban", "Platform Ops continuous flow. WIP limit: 3 tickets per person.", ["OPS"], "lucas");
    private DateTimeOffset _limit;
    private DateTimeOffset _current;
    private int _comments;
    private int _links;
    private int _extraTickets;

    public async Task<string> RunAsync(CancellationToken ct)
    {
        _limit = now.AddMinutes(-1);
        if (password is not null)
            ValidatePassword(password);

        await CreateUsersAsync(ct);
        await CreateProjectsAsync(ct);

        foreach (var project in DemoContent.Projects)
            PlanProject(project);
        PlanHistory();
        PlanBoards();
        PlanLinks();
        PlanTesting();
        PlanFlags();
        ScheduleTickets();

        foreach (var step in _timeline.OrderBy(s => s.At).ThenBy(s => s.Sequence))
            await step.Run(ct);

        if (password is null)
            await LogSetPasswordLinksAsync(ct);

        return $"{_createdUsers.Count} users, {DemoContent.Projects.Count} projects, {_tickets.Count + _extraTickets} tickets, "
            + $"{_comments} comments, {_links} links, {_testCaseKeys.Count} test cases, 2 regression sessions, 2 boards, 3 feature flags";
    }

    private static void ValidatePassword(string password)
    {
        try
        {
            foreach (var user in DemoContent.Users)
                PasswordPolicy.Validate(password, user.Email);
        }
        catch (DomainException ex)
        {
            throw new InvalidOperationException($"{DemoDataSetup.PasswordVariable} is not accepted: {ex.Message}", ex);
        }
    }

    private async Task CreateUsersAsync(CancellationToken ct)
    {
        var existing = await workspace.FindUsersAsync([.. DemoContent.Users.Select(u => u.Email)], ct);
        var at = Day(92);
        foreach (var user in DemoContent.Users)
        {
            if (existing.TryGetValue(user.Email, out var actor))
            {
                _users[user.Handle] = actor;
                continue;
            }

            at = Later(at, at.AddHours(Uniform(0.2, 2)));
            var created = await workspace.CreateUserAsync(admin, at, user.Email, user.DisplayName, ct);
            actor = new DemoActor(created.User.Id, created.User.Email, created.User.DisplayName, created.User.GlobalRole);
            _users[user.Handle] = actor;
            _createdUsers.Add(actor);
            if (password is not null)
                await workspace.SetPasswordAsync(actor, at.AddMinutes(20), created.SetPasswordLink.Token, password, ct);
        }
    }

    private async Task CreateProjectsAsync(CancellationToken ct)
    {
        var at = Day(89);
        foreach (var project in DemoContent.Projects)
        {
            at = Later(at, at.AddHours(Uniform(1, 6)));
            var owner = User(project.Owner);
            await workspace.CreateProjectAsync(owner, at, project.Key, project.Name, project.Description, project.Visibility, ct);
            foreach (var (handle, role) in project.Members)
            {
                at = Later(at, at.AddMinutes(Uniform(2, 20)));
                await workspace.AddMemberAsync(owner, at, project.Key, User(handle).Email, role, ct);
            }
        }
    }

    private void PlanProject(DemoProject project)
    {
        for (var i = 0; i < project.Epics.Count; i++)
        {
            var epic = Add(project, project.Epics[i], null, Day(HistoryDays - 2 - (i * 54.0 / project.Epics.Count) - Uniform(0, 3)));
            foreach (var child in project.Epics[i].Kids)
                PlanChild(project, child, epic);
        }
        foreach (var item in project.Loose)
            Add(project, item, null, Day(Uniform(1, HistoryDays - 4)));
    }

    private void PlanChild(DemoProject project, DemoItem item, PlannedTicket parent)
    {
        var window = (now - parent.CreatedAt).TotalDays;
        var share = parent.Type == TicketType.Epic ? 0.7 : 0.35;
        var ticket = Add(project, item, parent, Later(parent.CreatedAt, parent.CreatedAt.AddDays(Uniform(0.1, Math.Max(0.2, window * share)))));
        foreach (var child in item.Kids)
            PlanChild(project, child, ticket);
    }

    private PlannedTicket Add(DemoProject project, DemoItem item, PlannedTicket? parent, DateTimeOffset createdAt)
    {
        var ticket = new PlannedTicket(project, item, parent) { CreatedAt = createdAt };
        if (!_byTitle.TryAdd(item.Title, ticket))
            throw new InvalidOperationException($"Duplicate demo ticket title '{item.Title}'.");
        parent?.Children.Add(ticket);
        _tickets.Add(ticket);

        ticket.Reporter = item.Type switch
        {
            TicketType.Bug when project.Qa is { } qa && Chance(0.75) => qa,
            TicketType.Technical or TicketType.Spike => Pick(project.Workers),
            _ => Pick(project.Reporters),
        };
        ticket.Labels.AddRange(item.OwnLabels);
        if (ticket.EpicTicket is { } epic && epic != ticket)
            ticket.Labels.AddRange(epic.Item.OwnLabels);
        if (Chance(0.2))
            ticket.Labels.Add(Pick(project.SpareLabels));
        ticket.Priority = PickPriority(item.Type);
        if (item.Type == TicketType.Bug)
            ticket.Severity = Weighted([(Severity.Blocker, 4), (Severity.Critical, 14), (Severity.Major, 42), (Severity.Minor, 30), (Severity.Trivial, 10)]);
        ticket.Points = PickPoints(item.Type);
        return ticket;
    }

    private void PlanHistory()
    {
        foreach (var ticket in _tickets.Where(t => t.Type != TicketType.Epic))
            PlanStatus(ticket);
        foreach (var epic in _tickets.Where(t => t.Type == TicketType.Epic))
            PlanEpic(epic);
        foreach (var ticket in _tickets)
        {
            PlanVersion(ticket);
            ticket.Description = ticket.Item.Description
                ?? DemoTexts.Describe(new PlannedTicketView(ticket.Type, ticket.EpicTicket?.Item.Title, ticket.Version), _random);
            PlanComments(ticket);
        }
    }

    private void PlanStatus(PlannedTicket ticket)
    {
        var age = (now - ticket.CreatedAt).TotalDays;
        if (age < 0.4)
            MaybeAssignAtCreation(ticket);
        else if (Chance(Math.Clamp((age - 5) / 55, 0, 0.8)))
            PlanDone(ticket, age);
        else
            PlanOpen(ticket, age);
    }

    private void PlanDone(PlannedTicket ticket, double age)
    {
        var lifetime = Math.Min(Uniform(1.5, 18), age - 0.2);
        var doneAt = Later(ticket.CreatedAt, ticket.CreatedAt.AddDays(lifetime));
        var resolution = PickResolution(ticket);
        if (resolution is Resolution.WontDo or Resolution.Duplicate)
        {
            ticket.Transitions.Add(new(doneAt, TicketStatus.Done, resolution, ticket.Reporter));
            return;
        }

        ticket.Assignee = Pick(ticket.Project.Workers);
        List<TicketStatus> path = resolution == Resolution.CannotReproduce
            ? [TicketStatus.InProgress]
            : WorkPath(ticket, Chance(0.4) ? TicketStatus.ReadyForDeploy : TicketStatus.Testing);
        AddPath(ticket, path, ticket.CreatedAt.AddDays(lifetime * Uniform(0.05, 0.4)), doneAt);
        ticket.Transitions.Add(new(
            Later(ticket.LastActivity, doneAt), TicketStatus.Done, resolution == Resolution.Done ? null : resolution, Actor(ticket, TicketStatus.Done)));
    }

    private void PlanOpen(PlannedTicket ticket, double age)
    {
        var target = DrawOpenStatus(ticket);
        if (target == TicketStatus.ToDo)
        {
            MaybeAssignAtCreation(ticket);
            return;
        }

        ticket.Assignee = Pick(ticket.Project.Workers);
        List<TicketStatus> path = target == TicketStatus.OnHold ? [TicketStatus.InProgress, TicketStatus.OnHold] : WorkPath(ticket, target);
        var last = target == TicketStatus.OnHold
            ? now.AddDays(-Uniform(3, Math.Max(3.5, age * 0.75)))
            : now.AddDays(-Uniform(0.05, Math.Clamp(age * 0.6, 0.1, 9)));
        if (last < ticket.CreatedAt.AddHours(2))
            last = ticket.CreatedAt.AddHours(2);
        AddPath(ticket, path, ticket.CreatedAt + ((last - ticket.CreatedAt) * Uniform(0.1, 0.5)), last);
    }

    /// <summary>Takes the first card this ticket's type can reach (spikes are never tested, for example) and reshuffles an empty deck.</summary>
    private TicketStatus DrawOpenStatus(PlannedTicket ticket)
    {
        for (var refill = 0; refill < 2; refill++)
        {
            var index = _openStatuses.FindIndex(s => s is TicketStatus.ToDo or TicketStatus.OnHold || WorkPath(ticket, s)[^1] == s);
            if (index >= 0)
            {
                var status = _openStatuses[index];
                _openStatuses.RemoveAt(index);
                return status;
            }
            _openStatuses.AddRange(OpenStatusDeck.SelectMany(c => Enumerable.Repeat(c.Status, c.Copies)).OrderBy(_ => _random.Next()));
        }
        return TicketStatus.ToDo;
    }

    private void PlanEpic(PlannedTicket epic)
    {
        var descendants = epic.Children.Concat(epic.Children.SelectMany(c => c.Children)).ToList();
        var started = descendants.Where(d => d.Transitions.Count > 0).Select(d => d.Transitions[0].At).ToList();
        if (started.Count == 0)
            return;
        var first = started.Min();
        epic.Transitions.Add(new(Later(first, first.AddHours(1)), TicketStatus.InProgress, null, epic.Reporter));
        if (descendants.All(d => d.FinalStatus == TicketStatus.Done))
        {
            var last = descendants.Max(d => d.LastActivity);
            epic.Transitions.Add(new(Later(Max(last, epic.LastActivity), last.AddHours(3)), TicketStatus.Done, null, epic.Reporter));
        }
    }

    private void PlanVersion(PlannedTicket ticket)
    {
        if (!ticket.Project.Versioned || ticket.Type == TicketType.Epic)
            return;
        if (ticket.FinalStatus == TicketStatus.Done)
        {
            var last = ticket.Transitions[^1];
            if (last.Resolution is null)
                ticket.Version = last.At < Day(42) ? "1.3.0" : last.At < Day(8) ? "1.4.0" : "1.5.0";
            return;
        }
        if (ticket.FinalStatus != TicketStatus.ToDo)
        {
            ticket.Version = "1.5.0";
            return;
        }
        var roll = _random.NextDouble();
        ticket.Version = roll < 0.35 ? "1.5.0" : roll < 0.47 ? "1.6.0" : null;
    }

    private void PlanComments(PlannedTicket ticket)
    {
        var probability = ticket.Type switch { TicketType.Bug => 0.6, TicketType.Epic => 0.2, _ => 0.42 };
        if (!Chance(probability))
            return;
        var end = ticket.Transitions.Count > 0 ? ticket.LastActivity : Min(_limit, ticket.CreatedAt.AddDays(4));
        var at = ticket.CreatedAt;
        for (var i = 1 + _random.Next(3); i > 0; i--)
        {
            at = Later(at, at + ((end - at) * Uniform(0.1, 0.6)));
            var author = Pick(Writers(ticket.Project));
            var body = DemoTexts.Comment(ticket.Type, _random);
            var target = ticket;
            Schedule(at, async ct =>
            {
                await workspace.AddCommentAsync(User(author), Clock(), target.Key, body, ct);
                _comments++;
            });
        }
    }

    private void PlanBoards()
    {
        _sprint.CreatedAt = Day(10);
        _sprint.BlockAt = Later(_sprint.CreatedAt, Day(9));
        _kanban.CreatedAt = Day(70);
        _kanban.BlockAt = Later(_kanban.CreatedAt, _kanban.CreatedAt.AddHours(1));

        foreach (var ticket in _tickets.Where(t => t.Type != TicketType.Epic))
        {
            if (ticket.Project.Key == "OPS")
                PlanKanban(ticket);
            else
                PlanSprint(ticket);
        }

        foreach (var board in new[] { _sprint, _kanban })
        {
            Schedule(board.CreatedAt, async ct =>
                board.Id = (await workspace.CreateBoardAsync(User(board.Owner), Clock(), board.Name, board.Description, board.Projects, ct)).Id);
            var block = _tickets.Where(t => t.Board == board && t.InBlock)
                .OrderBy(t => t.Priority).ThenBy(t => t.CreatedAt).ToList();
            foreach (var chunk in block.Chunk(25))
                Schedule(board.BlockAt, ct => workspace.MoveTicketsAsync(User(board.Owner), Clock(), [.. chunk.Select(t => t.Key)], board.Id, null, ct));
        }
    }

    private void PlanSprint(PlannedTicket ticket)
    {
        var start = _sprint.BlockAt;
        if (ticket.CreatedAt < start)
        {
            var openAtStart = ticket.FinalStatus != TicketStatus.Done || ticket.LastActivity >= start;
            var workedInSprint = ticket.Transitions.Any(t => t.At > start);
            var planned = ticket.FinalStatus == TicketStatus.ToDo && ticket.CreatedAt > start.AddDays(-25) && Chance(0.4);
            if (openAtStart && (workedInSprint || planned))
                JoinBlock(ticket, _sprint);
        }
        else if (ticket.Transitions.Count > 0 || Chance(0.3))
        {
            ticket.Board = _sprint;
        }
    }

    private void PlanKanban(PlannedTicket ticket)
    {
        if (ticket.Transitions.Count == 0)
            return;
        if (ticket.Transitions[0].At > _kanban.BlockAt)
            (ticket.Board, ticket.BoardAt) = (_kanban, ticket.Transitions[0].At);
        else if (ticket.LastActivity > _kanban.BlockAt)
            JoinBlock(ticket, _kanban);
    }

    private static void JoinBlock(PlannedTicket ticket, PlannedBoard board)
    {
        ticket.Board = board;
        ticket.InBlock = true;
        ticket.BoardAt = board.BlockAt;
    }

    private void PlanLinks()
    {
        foreach (var epic in _tickets.Where(t => t.Type == TicketType.Epic))
        {
            var kids = epic.Children;
            if (kids.FirstOrDefault(k => k.Type == TicketType.Technical) is { } technical
                && kids.FirstOrDefault(k => k.Type == TicketType.UserStory) is { } story && Chance(0.7))
                PlanLink(technical.Reporter, technical, TicketLinkType.Blocks, story);
            if (kids.Count >= 3 && Chance(0.5))
            {
                var pair = kids.OrderBy(_ => _random.Next()).Take(2).ToList();
                PlanLink(pair[0].Reporter, pair[0], TicketLinkType.RelatesTo, pair[1]);
            }
        }

        foreach (var duplicate in _tickets.Where(t => t.DuplicateOf is not null))
            PlanLink(duplicate.Reporter, duplicate, TicketLinkType.Duplicates, duplicate.DuplicateOf!, duplicate.LastActivity.AddMinutes(-10));

        foreach (var link in DemoContent.CrossLinks)
            PlanLink(link.Actor, _byTitle[link.Source], link.Type, _byTitle[link.Target]);
    }

    private void PlanLink(string actor, PlannedTicket source, TicketLinkType type, PlannedTicket target, DateTimeOffset? at = null)
    {
        if (source == target || _linked.Contains((source, target)) || _linked.Contains((target, source)))
            return;
        _linked.Add((source, target));
        var created = Max(source.CreatedAt, target.CreatedAt);
        var when = at is { } fixedAt ? Max(fixedAt, created.AddMinutes(5)) : Later(created, created.AddDays(Uniform(0.1, 2)));
        Schedule(when, async ct =>
        {
            await workspace.LinkAsync(User(actor), Clock(), source.Key, type, target.Key, ct);
            _links++;
        });
    }

    private void PlanTesting()
    {
        var at = Day(50);
        foreach (var testCase in DemoContent.TestCases)
        {
            var when = testCase.AddedAfterFirstRegression ? Day(4) : at = Later(at, at.AddDays(Uniform(0.2, 1.1)));
            var ticket = testCase.Ticket is { } title ? _byTitle[title] : null;
            var linked = ticket is not null && ticket.CreatedAt < when ? ticket : null;
            Schedule(when, async ct =>
            {
                var command = new CreateTestCase.Command(
                    testCase.Title, testCase.Preconditions, testCase.Steps, testCase.Expected, testCase.Status, testCase.Automation,
                    linked?.Key, testCase.Project);
                _testCaseKeys[testCase.Title] = (await workspace.CreateTestCaseAsync(User("tomasz"), Clock(), command, ct)).Key;
            });
        }

        PlanFirstRegression();
        PlanSecondRegression();
    }

    private void PlanFirstRegression()
    {
        var session = string.Empty;
        var bug = string.Empty;
        var at = Day(9);
        Schedule(at, async ct => session = (await workspace.StartRegressionAsync(User("tomasz"), Clock(), "PAY", "Release 1.4.0", "1.4.0", ct)).Key);

        (string TestCase, string Tester, RegressionItemStatus Status, string? Note)[] results =
        [
            ("Pay with a Visa card without 3-D Secure", "tomasz", RegressionItemStatus.Passed, null),
            ("Pay with a card that requires 3-D Secure", "tomasz", RegressionItemStatus.Passed, null),
            ("Full refund from the back office", "daniel", RegressionItemStatus.Passed, null),
            ("Partial refund of one order line", "daniel", RegressionItemStatus.Passed, "Passed, but the dialog is slow with 30+ order lines."),
            ("Refund confirmation email", "tomasz", RegressionItemStatus.Failed, "The email shows $ instead of zł for PLN refunds."),
            ("Pay with a BLIK code", "tomasz", RegressionItemStatus.Passed, null),
            ("BLIK code expires after two minutes", "tomasz", RegressionItemStatus.Skipped, "Przelewy24 sandbox was down; the status mapping is covered by the automatic test."),
            ("Upgrade a subscription mid-cycle", "daniel", RegressionItemStatus.Passed, null),
        ];
        foreach (var (testCase, tester, status, note) in results)
        {
            at = Later(at, at.AddHours(Uniform(1, 6)));
            var overrides = status == RegressionItemStatus.Failed ? RegressionBug() : null;
            Schedule(at, async ct =>
            {
                var change = await workspace.RecordResultAsync(User(tester), Clock(), session, _testCaseKeys[testCase], status, note, overrides, ct);
                if (change.CreatedBug is { } created)
                {
                    bug = created.Key;
                    _extraTickets++;
                }
            });
        }

        var completed = Later(at, Day(7.5));
        Schedule(completed, ct => workspace.CompleteRegressionAsync(User("tomasz"), Clock(), session, ct));
        var started = Later(completed, completed.AddDays(0.8));
        Schedule(started, ct => workspace.MoveTicketsAsync(User("daniel"), Clock(), [bug], _sprint.Id, TicketStatus.InProgress, ct));
        var explained = Later(started, started.AddHours(3));
        Schedule(explained, async ct =>
        {
            await workspace.AddCommentAsync(User("daniel"), Clock(), bug,
                "Root cause: the template formats amounts with the shop's default culture instead of the order currency. Fix is in review.", ct);
            _comments++;
        });
        Schedule(Later(explained, explained.AddDays(1.2)), ct =>
            workspace.MoveTicketsAsync(User("daniel"), Clock(), [bug], _sprint.Id, TicketStatus.Review, ct));
    }

    private BugOverrides RegressionBug() => new()
    {
        Title = "Refund confirmation email shows the wrong currency symbol",
        Description = """
            Found in the **Release 1.4.0** regression (test case *Refund confirmation email*).

            | Order currency | Shown in the email |
            | --- | --- |
            | PLN | $ 120.00 |
            | EUR | € 35.00 |

            Expected: `120,00 zł` for PLN orders.
            """,
        Severity = Severity.Major,
        Priority = Priority.High,
        Labels = ["refunds", "regression"],
        Assignee = User("daniel").Email,
    };

    private void PlanSecondRegression()
    {
        var session = string.Empty;
        var at = Day(1);
        Schedule(at, async ct => session = (await workspace.StartRegressionAsync(User("tomasz"), Clock(), "PAY", "Release 1.5.0", "1.5.0", ct)).Key);
        (string TestCase, string Tester, RegressionItemStatus Status, string? Note)[] results =
        [
            ("Pay with a Visa card without 3-D Secure", "tomasz", RegressionItemStatus.Passed, null),
            ("Save a card during checkout", "tomasz", RegressionItemStatus.Passed, null),
            ("Full refund from the back office", "daniel", RegressionItemStatus.Passed, null),
            ("Pay with a BLIK code", "tomasz", RegressionItemStatus.Failed, "The confirmation screen keeps spinning on the sandbox; checking with Przelewy24 before filing a bug."),
        ];
        foreach (var (testCase, tester, status, note) in results)
        {
            at = Later(at, at.AddHours(Uniform(0.5, 3)));
            Schedule(at, ct => workspace.RecordResultAsync(User(tester), Clock(), session, _testCaseKeys[testCase], status, note, null, ct));
        }
    }

    private void PlanFlags()
    {
        Schedule(Day(60), ct => workspace.CreateFlagAsync(admin, Clock(),
            new CreateFlag.Command("checkout.new-layout", "Single-page checkout from the WEB checkout redesign.", Enabled: true, RolloutPercentage: 25), ct));
        Schedule(Day(35), ct => workspace.CreateFlagAsync(admin, Clock(),
            new CreateFlag.Command("payments.blik", "BLIK and Przelewy24 at checkout for the Polish market; internal testers only.", Enabled: true,
                TargetUserIds: [User("maya").Id, User("tomasz").Id]), ct));
        Schedule(Day(12), ct => workspace.CreateFlagAsync(admin, Clock(),
            new CreateFlag.Command("web.dark-mode", "Dark theme toggle in the user menu."), ct));
    }

    private void ScheduleTickets()
    {
        foreach (var ticket in _tickets)
        {
            Schedule(ticket.CreatedAt, async ct =>
            {
                var command = new CreateTicket.Command(
                    ticket.Item.Title, ticket.Type, ticket.Description,
                    Priority: ticket.Priority, Severity: ticket.Severity, StoryPoints: ticket.Points, Version: ticket.Version,
                    Labels: ticket.Labels, ParentKey: ticket.Parent?.Key,
                    Assignee: ticket.AssignedAtCreation ? User(ticket.Assignee!).Email : null,
                    BoardId: ticket.Board is { } board && ticket.BoardAt is null ? board.Id : null,
                    ProjectKeyOrId: ticket.Project.Key);
                ticket.Key = (await workspace.CreateTicketAsync(User(ticket.Reporter), Clock(), command, ct)).Key;
            });
            for (var i = 0; i < ticket.Transitions.Count; i++)
            {
                var transition = ticket.Transitions[i];
                var assign = i == 0 && !ticket.AssignedAtCreation ? ticket.Assignee : null;
                Schedule(transition.At, ct => ApplyAsync(ticket, transition, assign, ct));
            }
        }
    }

    private async Task ApplyAsync(PlannedTicket ticket, Transition transition, string? assign, CancellationToken ct)
    {
        var actor = User(transition.Actor);
        var onBoard = ticket.Board is not null && (ticket.BoardAt is null || ticket.BoardAt <= transition.At);
        if (onBoard && transition.Resolution is null)
        {
            if (assign is not null)
                await workspace.UpdateTicketAsync(actor, Clock(), new UpdateTicket.Command { KeyOrId = ticket.Key, Assignee = User(assign).Email }, ct);
            await workspace.MoveTicketsAsync(actor, Clock(), [ticket.Key], ticket.Board!.Id, transition.Status, ct);
            return;
        }

        var command = new UpdateTicket.Command { KeyOrId = ticket.Key, Status = transition.Status };
        if (transition.Resolution is { } resolution)
            command = command with { Resolution = resolution };
        if (assign is not null)
            command = command with { Assignee = User(assign).Email };
        await workspace.UpdateTicketAsync(actor, Clock(), command, ct);
    }

    private async Task LogSetPasswordLinksAsync(CancellationToken ct)
    {
        foreach (var user in _createdUsers)
        {
            var link = await workspace.IssueSetPasswordLinkAsync(admin, now, user.Id, ct);
            LogSetPasswordLink(logger, user.Email, link.Path, link.ExpiresAt);
        }
    }

    private void MaybeAssignAtCreation(PlannedTicket ticket)
    {
        if (!Chance(0.55))
            return;
        ticket.Assignee = Pick(ticket.Project.Workers);
        ticket.AssignedAtCreation = true;
    }

    private List<TicketStatus> WorkPath(PlannedTicket ticket, TicketStatus target)
    {
        var tested = ticket.Project.Qa is not null && ticket.Type is TicketType.UserStory or TicketType.Bug;
        var path = new List<TicketStatus>();
        foreach (var status in Flow)
        {
            var allowed = ticket.Type == TicketType.Spike
                ? status is TicketStatus.InProgress or TicketStatus.Review
                : tested || status is not (TicketStatus.ReadyForTesting or TicketStatus.Testing);
            if (allowed)
                path.Add(status);
            if (Array.IndexOf(Flow, status) >= Array.IndexOf(Flow, target))
                break;
        }
        return path;
    }

    private void AddPath(PlannedTicket ticket, List<TicketStatus> path, DateTimeOffset start, DateTimeOffset end)
    {
        var span = end - start;
        for (var i = 0; i < path.Count; i++)
        {
            var at = Later(ticket.LastActivity, start + (span * ((i + Uniform(0, 0.8)) / path.Count)));
            ticket.Transitions.Add(new(at, path[i], null, Actor(ticket, path[i])));
        }
    }

    private Resolution PickResolution(PlannedTicket ticket)
    {
        var roll = _random.NextDouble();
        if (ticket.Type != TicketType.Bug)
            return roll < 0.07 ? Resolution.WontDo : Resolution.Done;
        if (roll < 0.1)
            return Resolution.CannotReproduce;
        if (roll < 0.18)
        {
            var earlier = _tickets.Where(t => t.Project == ticket.Project && t.Type == TicketType.Bug && t.CreatedAt < ticket.CreatedAt).ToList();
            if (earlier.Count > 0)
            {
                ticket.DuplicateOf = Pick(earlier);
                return Resolution.Duplicate;
            }
        }
        return Resolution.Done;
    }

    private Priority PickPriority(TicketType type) => type switch
    {
        TicketType.Epic => Weighted([(Priority.Highest, 10), (Priority.High, 50), (Priority.Medium, 40)]),
        TicketType.Bug => Weighted([(Priority.Highest, 10), (Priority.High, 30), (Priority.Medium, 40), (Priority.Low, 15), (Priority.Lowest, 5)]),
        _ => Weighted([(Priority.Highest, 4), (Priority.High, 18), (Priority.Medium, 52), (Priority.Low, 20), (Priority.Lowest, 6)]),
    };

    private int? PickPoints(TicketType type) => type switch
    {
        TicketType.UserStory => Weighted<int?>([(1, 5), (2, 15), (3, 25), (5, 30), (8, 18), (13, 7)]),
        TicketType.Technical => Weighted<int?>([(1, 10), (2, 25), (3, 30), (5, 25), (8, 10)]),
        TicketType.Spike => Weighted<int?>([(null, 50), (2, 20), (3, 30)]),
        TicketType.Bug => Weighted<int?>([(null, 40), (1, 30), (2, 20), (3, 10)]),
        _ => null,
    };

    private string Actor(PlannedTicket ticket, TicketStatus status) =>
        status is TicketStatus.Testing or TicketStatus.ReadyForDeploy or TicketStatus.Done
        && ticket.Project.Qa is { } qa && ticket.Type is TicketType.UserStory or TicketType.Bug
            ? qa
            : ticket.Assignee ?? ticket.Reporter;

    private static List<string> Writers(DemoProject project) =>
        [project.Owner, .. project.Members.Where(m => m.Role != ProjectRole.Viewer).Select(m => m.Handle)];

    private DemoActor User(string handle) => _users[handle];

    /// <summary>The time of the step being replayed.</summary>
    private DateTimeOffset Clock() => _current;

    private void Schedule(DateTimeOffset at, Func<CancellationToken, Task> run)
    {
        var sequence = _timeline.Count;
        _timeline.Add(new Step(at, sequence, ct =>
        {
            _current = at;
            return run(ct);
        }));
    }

    private DateTimeOffset Day(double daysAgo) => Min(_limit, WorkTime(now.AddDays(-daysAgo)));

    /// <summary>A time after <paramref name="previous"/> (by 10 to 60 minutes at least), moved into working hours and never after now.</summary>
    private DateTimeOffset Later(DateTimeOffset previous, DateTimeOffset candidate)
    {
        var earliest = previous.AddMinutes(10 + _random.Next(50));
        var at = Max(Min(_limit, WorkTime(candidate)), earliest);
        return at <= _limit ? at : Max(_limit, previous.AddSeconds(1));
    }

    private static DateTimeOffset WorkTime(DateTimeOffset time)
    {
        var utc = time.ToUniversalTime();
        var at = new DateTimeOffset(utc.Year, utc.Month, utc.Day, 7 + (utc.Hour % 10), utc.Minute, utc.Second, TimeSpan.Zero);
        return at.DayOfWeek switch
        {
            DayOfWeek.Saturday => at.AddDays(-1),
            DayOfWeek.Sunday => at.AddDays(-2),
            _ => at,
        };
    }

    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

    private bool Chance(double probability) => _random.NextDouble() < probability;

    private double Uniform(double min, double max) => min + (_random.NextDouble() * (max - min));

    private T Pick<T>(IReadOnlyList<T> items) => items[_random.Next(items.Count)];

    private T Weighted<T>((T Value, int Weight)[] options)
    {
        var roll = _random.Next(options.Sum(o => o.Weight));
        foreach (var (value, weight) in options)
        {
            if (roll < weight)
                return value;
            roll -= weight;
        }
        return options[^1].Value;
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Demo user {Email}: set the password at {Path} (valid until {ExpiresAt:u}).")]
    private static partial void LogSetPasswordLink(ILogger logger, string email, string path, DateTimeOffset expiresAt);

    private sealed record Step(DateTimeOffset At, int Sequence, Func<CancellationToken, Task> Run);

    private sealed record Transition(DateTimeOffset At, TicketStatus Status, Resolution? Resolution, string Actor);

    private sealed class PlannedBoard(string name, string description, IReadOnlyList<string> projects, string owner)
    {
        public string Name { get; } = name;

        public string Description { get; } = description;

        public IReadOnlyList<string> Projects { get; } = projects;

        public string Owner { get; } = owner;

        public Guid Id { get; set; }

        public DateTimeOffset CreatedAt { get; set; }

        /// <summary>When the planned tickets are moved onto the board as one block.</summary>
        public DateTimeOffset BlockAt { get; set; }
    }

    private sealed class PlannedTicket(DemoProject project, DemoItem item, PlannedTicket? parent)
    {
        public DemoProject Project { get; } = project;

        public DemoItem Item { get; } = item;

        public PlannedTicket? Parent { get; } = parent;

        public List<PlannedTicket> Children { get; } = [];

        public TicketType Type => Item.Type;

        public PlannedTicket? EpicTicket => Type == TicketType.Epic ? this : Parent?.EpicTicket;

        public DateTimeOffset CreatedAt { get; init; }

        public string Reporter { get; set; } = string.Empty;

        public string? Assignee { get; set; }

        public bool AssignedAtCreation { get; set; }

        public Priority Priority { get; set; }

        public Severity? Severity { get; set; }

        public int? Points { get; set; }

        public string? Version { get; set; }

        public List<string> Labels { get; } = [];

        public string? Description { get; set; }

        public List<Transition> Transitions { get; } = [];

        public PlannedTicket? DuplicateOf { get; set; }

        /// <summary>The board the ticket ends up on: created there, moved in the board's block, or moved when work starts (<see cref="BoardAt"/>).</summary>
        public PlannedBoard? Board { get; set; }

        public bool InBlock { get; set; }

        public DateTimeOffset? BoardAt { get; set; }

        public string Key { get; set; } = string.Empty;

        public TicketStatus FinalStatus => Transitions.Count == 0 ? TicketStatus.ToDo : Transitions[^1].Status;

        public DateTimeOffset LastActivity => Transitions.Count == 0 ? CreatedAt : Transitions[^1].At;
    }
}
