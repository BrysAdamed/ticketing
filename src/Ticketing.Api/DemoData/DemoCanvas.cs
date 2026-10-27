using System.Globalization;
using System.Security;
using System.Text;
using System.Text.Json;

namespace Ticketing.Api.DemoData;

/// <summary>
/// A small Canvas drawing for the demo docs: labelled boxes joined by bound arrows, written both as the Excalidraw scene
/// the editor stores and as the light SVG picture the editor would export on publish, so embeds and PDF show it at once.
/// </summary>
internal sealed class DemoCanvas
{
    private const int BoxWidth = 200;
    private const int BoxHeight = 72;
    private const int Padding = 24;
    private const string Ink = "#1e1e1e";

    private readonly List<Shape> _boxes = [];
    private readonly List<Link> _links = [];

    public DemoCanvas Box(string id, int x, int y, string label, string fill = "transparent")
    {
        _boxes.Add(new Shape(id, x, y, label, fill));
        return this;
    }

    public DemoCanvas Arrow(string from, string to, string? label = null)
    {
        _links.Add(new Link($"{from}-{to}", Find(from), Find(to), label));
        return this;
    }

    /// <summary>The Excalidraw scene (<c>type: excalidraw</c>, no files) with deterministic ids and seeds.</summary>
    public string Scene()
    {
        var seed = 1;
        Dictionary<string, object?> Base(string id, string type, double x, double y, double width, double height) => new()
        {
            ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["width"] = width, ["height"] = height, ["angle"] = 0,
            ["strokeColor"] = Ink, ["backgroundColor"] = "transparent", ["fillStyle"] = "solid", ["strokeWidth"] = 2,
            ["strokeStyle"] = "solid", ["roughness"] = 1, ["opacity"] = 100, ["groupIds"] = Array.Empty<string>(), ["frameId"] = null,
            ["roundness"] = null, ["seed"] = seed++, ["version"] = 1, ["versionNonce"] = seed++, ["isDeleted"] = false,
            ["boundElements"] = new List<object>(), ["updated"] = 1, ["link"] = null, ["locked"] = false,
        };

        Dictionary<string, object?> Text(string id, string containerId, string text, double centerX, double centerY)
        {
            var width = text.Length * 10.0;
            var element = Base(id, "text", centerX - (width / 2), centerY - 12.5, width, 25);
            element["text"] = text;
            element["originalText"] = text;
            element["fontSize"] = 20;
            element["fontFamily"] = 5;
            element["textAlign"] = "center";
            element["verticalAlign"] = "middle";
            element["containerId"] = containerId;
            element["autoResize"] = true;
            element["lineHeight"] = 1.25;
            return element;
        }

        var elements = new List<Dictionary<string, object?>>();
        var shapes = new Dictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
        foreach (var box in _boxes)
        {
            var shape = Base(box.Id, "rectangle", box.X, box.Y, BoxWidth, BoxHeight);
            shape["backgroundColor"] = box.Fill;
            shape["roundness"] = new Dictionary<string, int> { ["type"] = 3 };
            var label = Text($"{box.Id}-label", box.Id, box.Label, box.CenterX, box.CenterY);
            Bound(shape).Add(new { id = label["id"], type = "text" });
            shapes[box.Id] = shape;
            elements.Add(shape);
            elements.Add(label);
        }

        foreach (var link in _links)
        {
            var (start, end) = Ends(link);
            var arrow = Base(link.Id, "arrow", start.X, start.Y, end.X - start.X, end.Y - start.Y);
            arrow["points"] = new[] { new[] { 0.0, 0.0 }, new[] { end.X - start.X, end.Y - start.Y } };
            arrow["startBinding"] = new { elementId = link.From.Id, focus = 0, gap = 4 };
            arrow["endBinding"] = new { elementId = link.To.Id, focus = 0, gap = 4 };
            arrow["startArrowhead"] = null;
            arrow["endArrowhead"] = "arrow";
            arrow["elbowed"] = false;
            arrow["roundness"] = new Dictionary<string, int> { ["type"] = 2 };
            Bound(shapes[link.From.Id]).Add(new { id = link.Id, type = "arrow" });
            Bound(shapes[link.To.Id]).Add(new { id = link.Id, type = "arrow" });
            elements.Add(arrow);
            if (link.Label is { } text)
            {
                var label = Text($"{link.Id}-label", link.Id, text, (start.X + end.X) / 2, (start.Y + end.Y) / 2);
                label["fontSize"] = 16;
                Bound(arrow).Add(new { id = label["id"], type = "text" });
                elements.Add(label);
            }
        }

        return JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["type"] = "excalidraw",
            ["version"] = 2,
            ["source"] = "https://ticketing.demo",
            ["elements"] = elements,
            ["appState"] = new Dictionary<string, object> { ["viewBackgroundColor"] = "#ffffff", ["gridSize"] = 20 },
            ["files"] = new Dictionary<string, object>(),
        });
    }

    /// <summary>The picture of <see cref="Scene"/>: white background, boxes, arrows with heads and their labels.</summary>
    public string Svg()
    {
        var left = _boxes.Min(b => b.X) - Padding;
        var top = _boxes.Min(b => b.Y) - Padding;
        var width = _boxes.Max(b => b.X + BoxWidth) + Padding - left;
        var height = _boxes.Max(b => b.Y + BoxHeight) + Padding - top;
        var svg = new StringBuilder();
        svg.Append(Invariant($"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left} {top} {width} {height}" width="{width}" height="{height}">"""));
        svg.Append(Invariant($"""<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="{Ink}"/></marker></defs>"""));
        svg.Append(Invariant($"""<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="#ffffff"/>"""));
        foreach (var box in _boxes)
        {
            var fill = box.Fill == "transparent" ? "#ffffff" : box.Fill;
            svg.Append(Invariant($"""<rect x="{box.X}" y="{box.Y}" width="{BoxWidth}" height="{BoxHeight}" rx="14" fill="{fill}" stroke="{Ink}" stroke-width="2"/>"""));
            svg.Append(Label(box.CenterX, box.CenterY, box.Label, 18));
        }
        foreach (var link in _links)
        {
            var (start, end) = Ends(link);
            svg.Append(Invariant($"""<line x1="{start.X}" y1="{start.Y}" x2="{end.X}" y2="{end.Y}" stroke="{Ink}" stroke-width="2" marker-end="url(#head)"/>"""));
            if (link.Label is { } text)
            {
                var (x, y) = ((start.X + end.X) / 2, (start.Y + end.Y) / 2);
                var labelWidth = (text.Length * 8) + 12;
                svg.Append(Invariant($"""<rect x="{x - (labelWidth / 2.0)}" y="{y - 11}" width="{labelWidth}" height="22" fill="#ffffff"/>"""));
                svg.Append(Label(x, y, text, 14));
            }
        }
        svg.Append("</svg>");
        return svg.ToString();
    }

    private static string Label(double x, double y, string text, int size) =>
        Invariant($"""<text x="{x}" y="{y}" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="{size}" fill="{Ink}">{SecurityElement.Escape(text)}</text>""");

    private static List<object> Bound(Dictionary<string, object?> element) => (List<object>)element["boundElements"]!;

    /// <summary>Joins the facing edges: side by side when the boxes do not overlap horizontally, otherwise top and bottom.</summary>
    private static ((double X, double Y) Start, (double X, double Y) End) Ends(Link link)
    {
        var (from, to) = (link.From, link.To);
        if (to.X >= from.X + BoxWidth)
            return ((from.X + BoxWidth + 4, from.CenterY), (to.X - 4, to.CenterY));
        if (from.X >= to.X + BoxWidth)
            return ((from.X - 4, from.CenterY), (to.X + BoxWidth + 4, to.CenterY));
        return to.Y > from.Y
            ? ((from.CenterX, from.Y + BoxHeight + 4), (to.CenterX, to.Y - 4))
            : ((from.CenterX, from.Y - 4), (to.CenterX, to.Y + BoxHeight + 4));
    }

    private Shape Find(string id) => _boxes.SingleOrDefault(b => b.Id == id) ?? throw new InvalidOperationException($"No demo canvas box '{id}'.");

    private static string Invariant(FormattableString text) => text.ToString(CultureInfo.InvariantCulture);

    private sealed record Shape(string Id, int X, int Y, string Label, string Fill)
    {
        public double CenterX => X + (BoxWidth / 2.0);

        public double CenterY => Y + (BoxHeight / 2.0);
    }

    private sealed record Link(string Id, Shape From, Shape To, string? Label);
}
