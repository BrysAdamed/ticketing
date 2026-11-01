import * as tabler from '@ng-icons/tabler-icons';
import { APP_ICONS } from './app-icons.generated';

describe('app icons', () => {
  it('are identical to the Tabler icons of the same name', () => {
    // Arrange
    const package_ = tabler as unknown as Record<string, string>;

    // Act / Assert
    for (const [name, svg] of Object.entries(APP_ICONS)) expect(svg, name).toBe(package_[name]);
  });
});
