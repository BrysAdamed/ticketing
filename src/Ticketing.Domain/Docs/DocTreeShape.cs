using System.Globalization;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

public readonly record struct DocTreeNode(Guid Id, Guid? ParentId, DocKind Kind);

/// <summary>
/// The structure of one project's non-deleted docs tree (ids, parents, kinds) and the tree rules: depth 6 (root children
/// are depth 1), 500 children per folder, 5 000 nodes per project, no folder inside its own subtree. Load it inside the
/// transaction that holds the project's docs tree lock, so the checks cannot race.
/// </summary>
public sealed class DocTreeShape
{
    public const int MaxDepth = 6;
    public const int MaxChildrenPerFolder = 500;
    public const int MaxNodesPerProject = 5_000;

    private readonly Dictionary<Guid, DocTreeNode> _nodes;
    private readonly Dictionary<Guid, List<Guid>> _children = [];
    private readonly List<Guid> _rootChildren = [];

    public DocTreeShape(IEnumerable<DocTreeNode> nodes)
    {
        _nodes = nodes.ToDictionary(n => n.Id);
        foreach (var node in _nodes.Values)
        {
            if (node.ParentId is { } parentId)
            {
                if (!_children.TryGetValue(parentId, out var list))
                    _children[parentId] = list = [];
                list.Add(node.Id);
            }
            else
            {
                _rootChildren.Add(node.Id);
            }
        }
    }

    public int Count => _nodes.Count;

    public bool Contains(Guid id) => _nodes.ContainsKey(id);

    public IReadOnlyList<Guid> ChildrenOf(Guid? parentId) =>
        parentId is { } id ? (_children.TryGetValue(id, out var list) ? list : []) : _rootChildren;

    /// <summary>The depth a node gets when placed directly under <paramref name="parentId"/> (root children are depth 1).</summary>
    public int DepthUnder(Guid? parentId)
    {
        var depth = 1;
        for (var current = parentId; current is { } id && _nodes.TryGetValue(id, out var node); current = node.ParentId)
            depth++;
        return depth;
    }

    /// <summary>1 for a page, diagram or empty folder; otherwise 1 + the height of the tallest child.</summary>
    public int HeightOf(Guid id) => 1 + ChildrenOf(id).Select(HeightOf).DefaultIfEmpty(0).Max();

    /// <summary>Every non-deleted node below <paramref name="id"/>, parents before children.</summary>
    public IReadOnlyList<Guid> DescendantsOf(Guid id)
    {
        var result = new List<Guid>();
        var queue = new Queue<Guid>(ChildrenOf(id));
        while (queue.TryDequeue(out var next))
        {
            result.Add(next);
            foreach (var child in ChildrenOf(next))
                queue.Enqueue(child);
        }
        return result;
    }

    public bool IsSelfOrDescendant(Guid candidate, Guid ancestorId)
    {
        for (Guid? current = candidate; current is { } id; current = _nodes.TryGetValue(id, out var node) ? node.ParentId : null)
        {
            if (id == ancestorId)
                return true;
        }
        return false;
    }

    /// <summary>Checks adding <paramref name="count"/> nodes (one subtree of <paramref name="height"/> levels, or siblings when height is 1) under <paramref name="parentId"/>.</summary>
    public void EnsureCanAdd(Guid? parentId, int count = 1, int height = 1)
    {
        if (Count + count > MaxNodesPerProject)
            throw DomainException.Conflict(
                DocErrors.ProjectLimit,
                string.Create(CultureInfo.InvariantCulture, $"A project can have at most {MaxNodesPerProject} docs."),
                "Delete docs you no longer need, or keep the material in another project.");
        EnsureDepth(parentId, height);
        EnsureRoom(parentId, 1);
    }

    /// <summary>Checks moving <paramref name="id"/> (with its subtree) under <paramref name="newParentId"/>.</summary>
    public void EnsureCanMove(Guid id, Guid? newParentId)
    {
        if (newParentId is { } target && IsSelfOrDescendant(target, id))
            throw DomainException.Conflict(DocErrors.TreeCycle, "A folder cannot be moved into itself or one of its subfolders.");
        EnsureDepth(newParentId, HeightOf(id));
        if (_nodes.TryGetValue(id, out var node) && node.ParentId != newParentId)
            EnsureRoom(newParentId, 1);
    }

    private void EnsureDepth(Guid? parentId, int height)
    {
        if (DepthUnder(parentId) + height - 1 > MaxDepth)
            throw DomainException.Conflict(
                DocErrors.TreeDepth,
                string.Create(CultureInfo.InvariantCulture, $"Docs can be nested at most {MaxDepth} levels deep."),
                "Pick a folder higher up in the tree.");
    }

    private void EnsureRoom(Guid? parentId, int count)
    {
        if (parentId is not null && ChildrenOf(parentId).Count + count > MaxChildrenPerFolder)
            throw DomainException.Conflict(
                DocErrors.FolderFull,
                string.Create(CultureInfo.InvariantCulture, $"A folder can hold at most {MaxChildrenPerFolder} docs."),
                "Create a subfolder or pick another folder.");
    }
}
