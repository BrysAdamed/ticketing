namespace Ticketing.Domain.Activity;

public enum ActivityEntityType
{
    Ticket = 1,
    TestCase = 2,
    RegressionSession = 3,
    Project = 4,
    Board = 5,
    User = 6,
    PersonalAccessToken = 7,
    FeatureFlag = 8,
    AgentPrompt = 9,
    Doc = 10,
}

public enum WriteChannel
{
    Web = 1,
    Api = 2,
    Mcp = 3,
}
