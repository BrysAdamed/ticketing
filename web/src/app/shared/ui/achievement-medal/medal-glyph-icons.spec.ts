import * as tabler from '@ng-icons/tabler-icons';
import * as copied from './medal-glyph-icons';

describe('medal glyph icons', () => {
  it('are identical to the Tabler icons of the same name', () => {
    // Arrange
    const package_ = tabler as unknown as Record<string, string>;

    // Act / Assert
    for (const [name, svg] of Object.entries(copied)) expect(svg, name).toBe(package_[name]);
  });
});
