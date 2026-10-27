import { promptSlotFromSlug, promptSlotLabel, promptSlotSlug } from './prompt-slugs';

describe('prompt slot slugs', () => {
  it('round-trips every instance slot through its URL segment', () => {
    // Arrange
    const slots = ['Epic', 'UserStory', 'Technical', 'Spike', 'Bug', 'Guardrails'] as const;

    // Act
    const slugs = slots.map(promptSlotSlug);

    // Assert
    expect(slugs).toEqual(['epic', 'user-story', 'technical', 'spike', 'bug', 'guardrails']);
    expect(slugs.map(promptSlotFromSlug)).toEqual([...slots]);
  });

  it('rejects unknown segments and labels slots for people', () => {
    // Assert
    expect(promptSlotFromSlug('story')).toBeNull();
    expect(promptSlotFromSlug(null)).toBeNull();
    expect(promptSlotFromSlug('GUARDRAILS')).toBe('Guardrails');
    expect(promptSlotLabel('UserStory')).toBe('User Story');
    expect(promptSlotLabel('Guardrails')).toBe('Guardrails');
  });
});
