namespace Ticketing.Domain.Tokens;

public enum PatScope
{
    ReadOnly = 1,
    ReadWrite = 2,
}

/// <summary>Derived token state for lists (spec 6.12); not stored.</summary>
public enum PatStatus
{
    Active = 1,
    Expired = 2,
    Revoked = 3,
}
