import { rovingIndex } from './roving-index';

describe('rovingIndex', () => {
  it.each([
    ['ArrowRight', 9, 10],
    ['ArrowLeft', 9, 8],
    ['ArrowDown', 9, 17],
    ['ArrowUp', 9, 1],
    ['Home', 9, 0],
    ['End', 9, 31],
  ])('%s from %i moves to %i in an 8-column grid of 32', (key, from, to) => {
    // Act
    const next = rovingIndex(key, from, 32, 8);

    // Assert
    expect(next).toBe(to);
  });

  it.each([
    ['ArrowRight', 31],
    ['ArrowLeft', 0],
    ['ArrowDown', 28],
    ['ArrowUp', 3],
  ])('%s stays at the edge (%i)', (key, from) => {
    // Act
    const next = rovingIndex(key, from, 32, 8);

    // Assert
    expect(next).toBe(from);
  });

  it('ignores other keys so Enter and Space reach the button', () => {
    // Assert
    expect(rovingIndex('Enter', 3, 32, 8)).toBeNull();
    expect(rovingIndex(' ', 3, 32, 8)).toBeNull();
  });
});
