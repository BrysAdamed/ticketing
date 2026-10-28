import { AUTO_SHOWN_GUIDES } from './auto-guides';
import { GUIDE_ID_MAX_LENGTH, GUIDE_ID_PATTERN } from './onboarding.models';

describe('AUTO_SHOWN_GUIDES', () => {
  it('starts with the welcome dialog', () => {
    // Assert
    expect(AUTO_SHOWN_GUIDES[0]).toEqual({ id: 'welcome', version: 1 });
  });

  it('has unique ids the server accepts', () => {
    // Arrange
    const ids = AUTO_SHOWN_GUIDES.map((g) => g.id);

    // Assert
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(GUIDE_ID_PATTERN);
      expect(id.length).toBeLessThanOrEqual(GUIDE_ID_MAX_LENGTH);
    }
  });

  it('only lists welcome, What is new and hint ids at a valid version', () => {
    // Assert
    for (const { id, version } of AUTO_SHOWN_GUIDES) {
      expect(id).toMatch(/^(welcome|whats-new\.\d{4}-\d{2}|hint\..+)$/);
      expect(Number.isInteger(version) && version >= 1 && version <= 1_000_000).toBe(true);
    }
  });
});
