namespace Ticketing.Domain.Achievements;

/// <summary>The achievement projector's watermark, a single row: activity up to <see cref="ProcessedUntil"/> has been evaluated (TKT-64).</summary>
public sealed class AchievementProjectorState
{
    public const int SingletonId = 1;

    private AchievementProjectorState()
    {
    }

    public int Id { get; private set; }

    public DateTimeOffset ProcessedUntil { get; private set; }

    public static AchievementProjectorState Create(DateTimeOffset processedUntil) => new() { Id = SingletonId, ProcessedUntil = processedUntil };

    public void Advance(DateTimeOffset processedUntil)
    {
        if (processedUntil > ProcessedUntil)
            ProcessedUntil = processedUntil;
    }
}
