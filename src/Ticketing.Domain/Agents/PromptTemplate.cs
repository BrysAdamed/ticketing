using System.Text;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Agents;

/// <summary>A template error at a 1-based line and column (UTF-16 code units), so an editor can underline it.</summary>
public sealed record PromptTemplateError(string Code, string Message, int Line, int Column);

/// <summary>
/// The agent prompt template language (spec 13.4): <c>{{name}}</c> (spaces inside the braces allowed), a flat
/// <c>{{#if name}}…{{/if}}</c> kept when the value is non-empty, and <c>\{{</c> for a literal <c>{{</c>. Values are inserted
/// verbatim in one pass, so a value that contains <c>{{</c> is never interpreted. No else, nesting, loops or filters.
/// </summary>
public sealed class PromptTemplate
{
    private const string Open = "{{";
    private const string Close = "}}";
    private const string IfPrefix = "#if";
    private const string EndIf = "/if";

    private readonly IReadOnlyList<Segment> _segments;

    private PromptTemplate(IReadOnlyList<Segment> segments) => _segments = segments;

    /// <summary>Parses <paramref name="body"/>, reporting every error rather than the first one.</summary>
    public static PromptTemplateParse Parse(string body, IReadOnlySet<string> placeholders)
    {
        ArgumentNullException.ThrowIfNull(body);
        var errors = new List<PromptTemplateError>();
        var root = new List<Segment>();
        List<Segment>? ifBody = null;
        string? ifName = null;
        var ifStart = 0;
        var text = new StringBuilder();

        void FlushText()
        {
            if (text.Length == 0)
                return;
            (ifBody ?? root).Add(new TextSegment(text.ToString()));
            text.Clear();
        }

        void Error(string code, string message, int index)
        {
            var (line, column) = Position(body, index);
            errors.Add(new PromptTemplateError(code, message, line, column));
        }

        var i = 0;
        while (i < body.Length)
        {
            if (body[i] == '\\' && string.CompareOrdinal(body, i + 1, Open, 0, Open.Length) == 0)
            {
                text.Append(Open);
                i += 1 + Open.Length;
                continue;
            }

            if (string.CompareOrdinal(body, i, Open, 0, Open.Length) != 0)
            {
                text.Append(body[i]);
                i++;
                continue;
            }

            var end = body.IndexOf(Close, i + Open.Length, StringComparison.Ordinal);
            if (end < 0)
            {
                Error(AgentErrors.UnclosedPlaceholder, "This {{ is never closed with }}.", i);
                text.Append(body, i, body.Length - i);
                break;
            }

            var tag = body[(i + Open.Length)..end].Trim();
            var tagStart = i;
            i = end + Close.Length;

            if (tag == EndIf)
            {
                if (ifBody is null)
                {
                    Error(AgentErrors.UnbalancedIf, "This {{/if}} has no matching {{#if}}.", tagStart);
                    continue;
                }
                FlushText();
                root.Add(new IfSegment(ifName!, ifBody));
                ifBody = null;
                ifName = null;
                continue;
            }

            if (tag.StartsWith(IfPrefix, StringComparison.Ordinal) && (tag.Length == IfPrefix.Length || char.IsWhiteSpace(tag[IfPrefix.Length])))
            {
                var name = tag[IfPrefix.Length..].Trim();
                if (ifBody is not null)
                {
                    Error(AgentErrors.NestedIf, "{{#if}} blocks cannot be nested; close the previous one with {{/if}} first.", tagStart);
                    continue;
                }
                if (!placeholders.Contains(name))
                    Error(AgentErrors.UnknownPlaceholder, UnknownMessage(name), tagStart);
                FlushText();
                ifBody = [];
                ifName = name;
                ifStart = tagStart;
                continue;
            }

            if (!placeholders.Contains(tag))
            {
                Error(AgentErrors.UnknownPlaceholder, UnknownMessage(tag), tagStart);
                continue;
            }
            FlushText();
            (ifBody ?? root).Add(new ValueSegment(tag));
        }

        FlushText();
        if (ifBody is not null)
            Error(AgentErrors.UnbalancedIf, "This {{#if}} is never closed with {{/if}}.", ifStart);

        errors.Sort((a, b) => a.Line != b.Line ? a.Line.CompareTo(b.Line) : a.Column.CompareTo(b.Column));
        return errors.Count == 0 ? new PromptTemplateParse(new PromptTemplate(root), errors) : new PromptTemplateParse(null, errors);
    }

    /// <summary>Renders the template; a missing or null value renders as empty.</summary>
    public string Render(IReadOnlyDictionary<string, string?> values)
    {
        var output = new StringBuilder();
        foreach (var segment in _segments)
            Append(output, segment, values);
        return output.ToString();
    }

    private static void Append(StringBuilder output, Segment segment, IReadOnlyDictionary<string, string?> values)
    {
        switch (segment)
        {
            case TextSegment text:
                output.Append(text.Text);
                break;
            case ValueSegment value:
                output.Append(values.GetValueOrDefault(value.Name));
                break;
            case IfSegment block when !string.IsNullOrWhiteSpace(values.GetValueOrDefault(block.Name)):
                foreach (var inner in block.Body)
                    Append(output, inner, values);
                break;
        }
    }

    private const int EchoedNameMaxLength = 40;

    private static string UnknownMessage(string name) =>
        name.Length == 0
            ? "A placeholder needs a name, for example {{ticket.key}}."
            : $"Unknown placeholder '{(name.Length > EchoedNameMaxLength ? name[..EchoedNameMaxLength] + "…" : name)}'.";

    private static (int Line, int Column) Position(string body, int index)
    {
        var line = 1;
        var lineStart = 0;
        for (var i = 0; i < index; i++)
        {
            if (body[i] != '\n')
                continue;
            line++;
            lineStart = i + 1;
        }
        return (line, index - lineStart + 1);
    }

    private abstract record Segment;

    private sealed record TextSegment(string Text) : Segment;

    private sealed record ValueSegment(string Name) : Segment;

    private sealed record IfSegment(string Name, IReadOnlyList<Segment> Body) : Segment;
}

public sealed record PromptTemplateParse(PromptTemplate? Template, IReadOnlyList<PromptTemplateError> Errors)
{
    public bool IsValid => Template is not null;

    /// <summary>The parsed template, or a validation <see cref="DomainException"/> on <paramref name="field"/> naming the first error and its position.</summary>
    public PromptTemplate EnsureValid(string field)
    {
        if (Template is not null)
            return Template;
        var first = Errors[0];
        throw DomainException.Invalid(field, first.Code, $"Line {first.Line}, column {first.Column}: {first.Message}");
    }
}
