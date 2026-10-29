import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AchievementMedalComponent } from './achievement-medal.component';
import {
  medalLabel,
  pipPositions,
  progressText,
  sharedTierCount,
  tierText,
} from './achievement-medal.logic';
import { medalGlyph } from './medal-glyphs';

describe('achievement medal logic', () => {
  it('writes the tier by name, "Earned" for one-time achievements', () => {
    // Act / Assert
    expect(tierText({ tier: 0, tierCount: 4 })).toBe('Not earned yet');
    expect(tierText({ tier: 3, tierCount: 4 })).toBe('Gold');
    expect(tierText({ tier: 1, tierCount: 1 })).toBe('Earned');
  });

  it('names the next tier in the progress text, nothing at the top or for one-time ones', () => {
    // Act / Assert
    expect(progressText(23, 3, 50, 4)).toBe('23 of 50 to Gold');
    expect(progressText(300, null, null, 4)).toBeNull();
    expect(progressText(0, 1, 1, 1)).toBeNull();
  });

  it('builds accessible names that never rely on colour', () => {
    // Act / Assert
    expect(
      medalLabel({ name: 'Closer', tier: 3, tierCount: 4, secret: false, masked: false }),
    ).toBe('Closer, Gold');
    expect(
      medalLabel({ name: 'Board builder', tier: 1, tierCount: 1, secret: false, masked: false }),
    ).toBe('Board builder, earned');
    expect(
      medalLabel({
        name: 'Triage',
        tier: 0,
        tierCount: 3,
        secret: false,
        masked: false,
        progress: '4 of 10 to Bronze',
      }),
    ).toBe('Triage, not earned yet, 4 of 10 to Bronze');
    expect(medalLabel({ name: null, tier: 0, tierCount: 0, secret: true, masked: true })).toBe(
      'Secret achievement, not earned yet',
    );
    expect(
      medalLabel({
        name: 'Closer',
        tier: 3,
        tierCount: 4,
        secret: false,
        masked: false,
        shared: true,
      }),
    ).toBe('Closer, Gold, shared');
  });

  it('draws shared one-time achievements with a single tier and the rest with four', () => {
    // Act / Assert
    expect(sharedTierCount('board-builder')).toBe(1);
    expect(sharedTierCount('grand-tour')).toBe(1);
    expect(sharedTierCount('reporter')).toBe(4);
  });

  it('centres one pip per tier reached', () => {
    // Act / Assert
    expect(pipPositions(1)).toEqual([24]);
    expect(pipPositions(4)).toEqual([13.5, 20.5, 27.5, 34.5]);
    expect(pipPositions(0)).toEqual([]);
  });

  it('maps kebab-case catalogue icons to registered glyphs, with fallbacks', () => {
    // Act / Assert
    expect(medalGlyph('file-plus')).toBe('tablerFilePlus');
    expect(medalGlyph('zoom-exclamation')).toBe('tablerZoomExclamation');
    expect(medalGlyph('not-an-icon')).toBe('tablerAward');
    expect(medalGlyph(null)).toBe('tablerQuestionMark');
  });
});

describe('AchievementMedalComponent', () => {
  function render(inputs: Record<string, unknown>): HTMLElement {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(AchievementMedalComponent);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the tier ring and one pip per tier, tinted from the palette', () => {
    // Act
    const medal = render({ achievementId: 'closer', icon: 'circle-check', tier: 3 });

    // Assert
    expect(medal.querySelector('.ring')).not.toBeNull();
    expect(medal.querySelectorAll('.pip')).toHaveLength(3);
    expect(medal.getAttribute('style')).toContain('--tk-medal-tier: var(--tk-tier-gold)');
    expect(medal.getAttribute('style')).toMatch(/--tk-medal: var\(--tk-palette-\d\)/);
    expect(medal.getAttribute('aria-hidden')).toBe('true');
  });

  it('is dashed with no ring or pips while locked', () => {
    // Act
    const medal = render({ achievementId: 'connector', icon: 'link', tier: 0 });

    // Assert
    expect(medal.classList).toContain('locked');
    expect(medal.querySelector('.ring')).toBeNull();
    expect(medal.querySelectorAll('.pip')).toHaveLength(0);
  });

  it('gives one-time achievements a thin ring and no pips', () => {
    // Act
    const medal = render({ achievementId: 'board-builder', tier: 1, tierCount: 1 });

    // Assert
    expect(medal.classList).toContain('once');
    expect(medal.querySelectorAll('.pip')).toHaveLength(0);
  });

  it('drops the pip row at 20px', () => {
    // Act
    const medal = render({ achievementId: 'closer', tier: 2, size: 20 });

    // Assert
    expect(medal.querySelectorAll('.pip')).toHaveLength(0);
    expect(medal.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 48 48');
  });

  it('marks a shared medal for its owner, and only when asked', () => {
    // Act
    const shared = render({ achievementId: 'closer', tier: 3, shared: true });

    // Assert
    expect(shared.querySelector('[data-testid="medal-shared"]')).not.toBeNull();
    TestBed.resetTestingModule();
    expect(
      render({ achievementId: 'closer', tier: 3 }).querySelector('[data-testid="medal-shared"]'),
    ).toBeNull();
  });

  it('is an image with its name when standalone', () => {
    // Act
    const medal = render({ achievementId: 'closer', tier: 3, label: 'Closer, Gold' });

    // Assert
    expect(medal.getAttribute('role')).toBe('img');
    expect(medal.getAttribute('aria-label')).toBe('Closer, Gold');
    expect(medal.getAttribute('aria-hidden')).toBeNull();
  });
});
