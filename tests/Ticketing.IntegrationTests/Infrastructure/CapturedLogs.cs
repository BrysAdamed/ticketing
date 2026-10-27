using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Ticketing.IntegrationTests.Infrastructure;

/// <summary>
/// Every log line and scope the API host writes at the levels it is captured at, formatted with its values and exception, so tests can assert that secrets
/// (prompts, local paths, tokens) never reach the logs. Cleared before each test.
/// </summary>
public sealed class CapturedLogs : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _lines = new();

    public IReadOnlyCollection<string> Lines => _lines;

    public void Clear() => _lines.Clear();

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _lines);

    public void Dispose()
    {
    }

    private sealed class Logger(string category, ConcurrentQueue<string> lines) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
        {
            lines.Enqueue($"Scope {category}: {state} {Values(state)}");
            return null;
        }

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            lines.Enqueue($"{logLevel} {category}: {formatter(state, exception)} {Values(state)} {exception}");

        private static string Values<TState>(TState state) =>
            state is IEnumerable<KeyValuePair<string, object?>> pairs ? string.Join(" ", pairs.Select(p => $"{p.Key}={p.Value}")) : string.Empty;
    }
}
