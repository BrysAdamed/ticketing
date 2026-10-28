import { paletteIndex } from '@shared/util/hash';
import { AVATAR_ART } from './avatar-art.generated';
import { AVATAR_ICONS, UserAvatar } from './avatar-catalog';
import { AvatarSource, resolveAvatar } from './avatar-source';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

function sourceWith(avatar: UserAvatar | null, art: Record<string, string> | null): AvatarSource {
  return {
    avatarOf: () => avatar,
    imageOf: (icon) => (art ? (art[icon] ?? null) : null),
  };
}

describe('resolveAvatar', () => {
  it('uses initials on the hashed colour without a source or a chosen avatar', () => {
    // Act
    const noSource = resolveAvatar(null, ID, ID);
    const noChoice = resolveAvatar(sourceWith(null, {}), ID, ID);

    // Assert
    const initials = { palette: paletteIndex(ID), icon: null, src: null, pending: false };
    expect(noSource).toEqual(initials);
    expect(noChoice).toEqual(initials);
  });

  it('draws the chosen icon on the chosen colour', () => {
    // Act
    const avatar = resolveAvatar(sourceWith({ icon: 'fox', color: 'teal' }, { fox: 'x' }), ID, ID);

    // Assert
    expect(avatar).toEqual({ palette: 6, icon: 'fox', src: 'x', pending: false });
  });

  it('is pending while the art loads', () => {
    // Act
    const avatar = resolveAvatar(sourceWith({ icon: 'fox', color: null }, null), ID, ID);

    // Assert
    expect(avatar).toEqual({ palette: paletteIndex(ID), icon: 'fox', src: null, pending: true });
  });

  it('falls back to initials on the stored colour for a key that left the catalogue', () => {
    // Act
    const avatar = resolveAvatar(sourceWith({ icon: 'dodo', color: 'amber' }, {}), ID, ID);

    // Assert
    expect(avatar).toEqual({ palette: 4, icon: null, src: null, pending: false });
  });
});

describe('avatar catalogue', () => {
  it('has art for every icon and no art without an icon', () => {
    // Assert
    expect(Object.keys(AVATAR_ART).sort()).toEqual(AVATAR_ICONS.map((i) => i.key).sort());
    expect(AVATAR_ICONS).toHaveLength(32);
  });

  it('ships SVGs without scripts, links or ids that could clash', () => {
    // Assert
    for (const svg of Object.values(AVATAR_ART)) {
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/<script|href=|on[a-z]+=/i);
    }
  });
});
