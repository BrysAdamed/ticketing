using Ticketing.Domain.Comments;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tests.Comments;

public sealed class CommentTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid Author = Guid.CreateVersion7();
    private static readonly Guid Other = Guid.CreateVersion7();

    [Fact]
    public void Author_edits_and_gets_the_previous_body_back()
    {
        // Arrange
        var comment = Comment.Create(Guid.CreateVersion7(), Author, " First ", Now);

        // Act
        var previous = comment.EditBy(Author, "Second", Now.AddMinutes(1));

        // Assert
        Assert.Equal(("First", "Second", Now.AddMinutes(1)), (previous, comment.Body, comment.EditedAt!.Value));
    }

    [Fact]
    public void Others_cannot_edit() =>
        Assert.Equal(
            (CommentErrors.NotAuthor, DomainErrorKind.Forbidden),
            Error(() => Comment.Create(Guid.CreateVersion7(), Author, "Body", Now).EditBy(Other, "x", Now)));

    [Fact]
    public void Owners_delete_any_comment_others_only_their_own()
    {
        // Arrange
        var comment = Comment.Create(Guid.CreateVersion7(), Author, "Body", Now);

        // Act
        var byMember = Error(() => comment.DeleteBy(Other, actorIsProjectOwner: false, Now));
        comment.DeleteBy(Other, actorIsProjectOwner: true, Now);

        // Assert
        Assert.Equal(CommentErrors.NotAuthor, byMember.Code);
        Assert.Equal((true, string.Empty, (Guid?)Other), (comment.IsDeleted, comment.Body, comment.DeletedById));
    }

    [Fact]
    public void Deleted_comments_cannot_be_edited()
    {
        // Arrange
        var comment = Comment.Create(Guid.CreateVersion7(), Author, "Body", Now);
        comment.DeleteBy(Author, actorIsProjectOwner: false, Now);

        // Act / Assert
        Assert.Equal(CommentErrors.Deleted, Error(() => comment.EditBy(Author, "Again", Now)).Code);
    }

    private static (string Code, DomainErrorKind Kind) Error(Action action)
    {
        var error = Assert.Throws<DomainException>(action);
        return (error.Code, error.Kind);
    }
}
