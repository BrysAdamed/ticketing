using System.Text.Json;

namespace Ticketing.Domain.Docs;

/// <summary>
/// The text of a Canvas diagram (an Excalidraw scene in its native JSON) for search and MCP: the labels of shapes,
/// standalone texts and frames in reading order, and the connector relations between labelled elements
/// (<c>API → DB</c>). Deleted elements are ignored; an arrow counts only when both of its ends are bound.
/// </summary>
public sealed record CanvasOutline(IReadOnlyList<string> Labels, IReadOnlyList<CanvasRelation> Relations)
{
    public static readonly CanvasOutline Empty = new([], []);

    /// <summary>Parses Excalidraw scene JSON. Throws <see cref="FormatException"/> when it is not a scene.</summary>
    public static CanvasOutline Extract(string source)
    {
        if (string.IsNullOrWhiteSpace(source))
            return Empty;
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(source);
        }
        catch (JsonException exception)
        {
            throw new FormatException("Canvas source is not valid JSON.", exception);
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("elements", out var elements)
                || elements.ValueKind != JsonValueKind.Array)
                throw new FormatException("Canvas source is not an Excalidraw scene.");
            return FromElements(elements);
        }
    }

    /// <summary>Labels, then relations, one per line: the plain-text form used for the search index.</summary>
    public string ToText() => string.Join('\n', Labels.Concat(Relations.Select(r => r.ToString())));

    internal static CanvasOutline FromElements(JsonElement elements)
    {
        var live = elements.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.Object && !Bool(e, "isDeleted") && Str(e, "id") is not null)
            .Select(e => new Element(e))
            .ToList();
        var byId = live.GroupBy(e => e.Id).ToDictionary(g => g.Key, g => g.First());
        var boundText = live
            .Where(e => e.Type == "text" && e.ContainerId is not null && byId.ContainsKey(e.ContainerId))
            .GroupBy(e => e.ContainerId!)
            .ToDictionary(g => g.Key, g => string.Join(" ", g.Select(t => t.Text).Where(t => t.Length > 0)));

        string? LabelOf(Element element) => element.Type switch
        {
            "text" => element.Text.Length > 0 ? element.Text : null,
            "frame" or "magicframe" => element.Name,
            _ => boundText.GetValueOrDefault(element.Id) is { Length: > 0 } label ? label : null,
        };

        var labels = live
            .Where(e => !IsConnector(e) && !(e.Type == "text" && e.ContainerId is not null && byId.ContainsKey(e.ContainerId)))
            .Select(e => (Element: e, Label: LabelOf(e)))
            .Where(x => x.Label is not null)
            .OrderBy(x => Math.Round(x.Element.Y))
            .ThenBy(x => x.Element.X)
            .Select(x => x.Label!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var relations = new List<CanvasRelation>();
        foreach (var connector in live.Where(IsConnector))
        {
            if (connector.StartId is null || connector.EndId is null
                || !byId.TryGetValue(connector.StartId, out var start) || !byId.TryGetValue(connector.EndId, out var end))
                continue;
            var from = LabelOf(start) ?? $"[{start.Type}]";
            var to = LabelOf(end) ?? $"[{end.Type}]";
            var direction = (connector.StartArrowhead, connector.EndArrowhead) switch
            {
                (true, true) => RelationDirection.Both,
                (false, false) => RelationDirection.None,
                _ => RelationDirection.Forward,
            };
            if (connector.StartArrowhead && !connector.EndArrowhead)
                (from, to) = (to, from);
            relations.Add(new CanvasRelation(from, to, direction, boundText.GetValueOrDefault(connector.Id)));
        }

        return new CanvasOutline(labels, relations.Distinct().ToList());
    }

    private static bool IsConnector(Element element) => element.Type is "arrow" or "line";

    private static string? Str(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool Bool(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static double Num(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : 0;

    private static string? BindingTarget(JsonElement element, string name) =>
        element.TryGetProperty(name, out var binding) && binding.ValueKind == JsonValueKind.Object
            ? Str(binding, "elementId")
            : null;

    private static string Normalize(string? text) =>
        string.Join(' ', (text ?? string.Empty).Split((char[])['\n', '\r', '\t', ' '], StringSplitOptions.RemoveEmptyEntries));

    private sealed class Element(JsonElement json)
    {
        public string Id { get; } = Str(json, "id")!;
        public string Type { get; } = Str(json, "type") ?? string.Empty;
        public double X { get; } = Num(json, "x");
        public double Y { get; } = Num(json, "y");
        public string Text { get; } = Normalize(Str(json, "originalText") ?? Str(json, "text"));
        public string? Name { get; } = Normalize(Str(json, "name")) is { Length: > 0 } name ? name : null;
        public string? ContainerId { get; } = Str(json, "containerId");
        public string? StartId { get; } = BindingTarget(json, "startBinding");
        public string? EndId { get; } = BindingTarget(json, "endBinding");
        public bool StartArrowhead { get; } = Str(json, "startArrowhead") is not null;
        public bool EndArrowhead { get; } = Str(json, "endArrowhead") is not null;
    }
}

public enum RelationDirection
{
    Forward,
    Both,
    None,
}

/// <summary>A connector between two labelled Canvas elements; <see cref="ToString"/> gives <c>API → DB (SQL)</c>.</summary>
public sealed record CanvasRelation(string From, string To, RelationDirection Direction, string? Label = null)
{
    public override string ToString()
    {
        var arrow = Direction switch
        {
            RelationDirection.Both => "↔",
            RelationDirection.None => "—",
            _ => "→",
        };
        var relation = $"{From} {arrow} {To}";
        return string.IsNullOrEmpty(Label) ? relation : $"{relation} ({Label})";
    }
}
