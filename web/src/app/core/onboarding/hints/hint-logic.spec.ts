import { HintDefinition, HINTS, hintById } from '../guides/hints';
import { GUIDE_ID_PATTERN } from '../onboarding.models';
import {
  HintCandidate,
  HintConditions,
  isCoveredByOverlay,
  openBackdrops,
  visibleHint,
} from './hint-logic';

const FREE = hintById('hint.free-transitions');
const BACKLOG = hintById('hint.backlog-vs-boards');

function candidate(token: number, hint: HintDefinition, extra: Partial<HintCandidate> = {}) {
  return { token, hint, canWrite: true, coveredByOverlay: false, ...extra };
}

function conditions(extra: Partial<HintConditions> = {}): HintConditions {
  return { loaded: true, tourRunning: false, isSeen: () => false, ...extra };
}

describe('hints data', () => {
  it('has unique, valid hint ids at a positive version', () => {
    // Arrange
    const ids = HINTS.map((h) => h.id);

    // Assert
    expect(new Set(ids).size).toBe(ids.length);
    for (const hint of HINTS) {
      expect(hint.id).toMatch(/^hint\./);
      expect(hint.id).toMatch(GUIDE_ID_PATTERN);
      expect(hint.version).toBeGreaterThan(0);
      expect(hint.title.length).toBeGreaterThan(0);
      expect(hint.body.length).toBeGreaterThan(0);
    }
  });

  it('marks free transitions as a write hint', () => {
    expect(FREE.requires).toBe('write');
    expect(BACKLOG.requires).toBeUndefined();
  });
});

describe('visibleHint', () => {
  it('shows nothing until the onboarding state has loaded', () => {
    expect(visibleHint([candidate(1, BACKLOG)], conditions({ loaded: false }))).toBeNull();
  });

  it('shows nothing while a tour runs', () => {
    expect(visibleHint([candidate(1, BACKLOG)], conditions({ tourRunning: true }))).toBeNull();
  });

  it('shows only the first registered hint', () => {
    // Act
    const shown = visibleHint([candidate(1, BACKLOG), candidate(2, FREE)], conditions());

    // Assert
    expect(shown).toBe(1);
  });

  it('skips a hint seen at its version, but not one seen at an older version', () => {
    // Arrange
    const seen = (id: string, version: number) => id === BACKLOG.id && version <= 1;
    const raised = { ...BACKLOG, version: 2 };

    // Act
    const shown = visibleHint(
      [candidate(1, BACKLOG), candidate(2, FREE)],
      conditions({ isSeen: seen }),
    );
    const again = visibleHint([candidate(1, raised)], conditions({ isSeen: seen }));

    // Assert
    expect(shown).toBe(2);
    expect(again).toBe(1);
  });

  it('hides a write hint from a user who cannot write there', () => {
    // Act
    const viewer = visibleHint([candidate(1, FREE, { canWrite: false })], conditions());
    const readHint = visibleHint([candidate(1, BACKLOG, { canWrite: false })], conditions());

    // Assert
    expect(viewer).toBeNull();
    expect(readHint).toBe(1);
  });

  it('passes over a hint covered by another overlay to the next one', () => {
    // Act
    const shown = visibleHint(
      [candidate(1, BACKLOG, { coveredByOverlay: true }), candidate(2, FREE)],
      conditions(),
    );

    // Assert
    expect(shown).toBe(2);
  });
});

describe('isCoveredByOverlay', () => {
  afterEach(() => (document.body.innerHTML = ''));

  function backdrop(parent: Element, open = true): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cdk-overlay-backdrop';
    if (!open) element.style.pointerEvents = 'none';
    parent.appendChild(element);
    return element;
  }

  function popoverOverlay(): { hint: HTMLElement; backdrop: HTMLElement } {
    const host = document.createElement('div');
    host.className = 'cdk-overlay-popover';
    document.body.appendChild(host);
    const own = backdrop(host);
    const box = document.createElement('div');
    box.innerHTML = '<div class="cdk-overlay-pane"><div><span class="hint"></span></div></div>';
    host.appendChild(box);
    return { hint: host.querySelector<HTMLElement>('.hint')!, backdrop: own };
  }

  it('is not covered on a page with no overlay open', () => {
    // Arrange
    const hint = document.body.appendChild(document.createElement('div'));

    // Assert
    expect(isCoveredByOverlay(hint, openBackdrops(document))).toBe(false);
  });

  it('is covered on the page by a dialog or picker backdrop', () => {
    // Arrange
    const hint = document.body.appendChild(document.createElement('div'));
    backdrop(document.body);

    // Assert
    expect(isCoveredByOverlay(hint, openBackdrops(document))).toBe(true);
  });

  it('ignores a backdrop that is detaching', () => {
    // Arrange
    const hint = document.body.appendChild(document.createElement('div'));
    backdrop(document.body, false);

    // Assert
    expect(isCoveredByOverlay(hint, openBackdrops(document))).toBe(false);
  });

  it('is not covered by the backdrop of the popover overlay it sits in', () => {
    // Arrange
    const { hint } = popoverOverlay();

    // Assert
    expect(isCoveredByOverlay(hint, openBackdrops(document))).toBe(false);
  });

  it('is not covered by the backdrop the CDK puts before its overlay host', () => {
    // Arrange
    const container = document.body.appendChild(document.createElement('div'));
    backdrop(container);
    const host = container.appendChild(document.createElement('div'));
    host.innerHTML = '<div class="cdk-overlay-pane"><span class="hint"></span></div>';

    // Assert
    expect(isCoveredByOverlay(host.querySelector('.hint')!, openBackdrops(document))).toBe(false);
  });

  it('is covered when a dialog opens over the picker it sits in', () => {
    // Arrange
    const { hint } = popoverOverlay();
    backdrop(document.body);

    // Assert
    expect(isCoveredByOverlay(hint, openBackdrops(document))).toBe(true);
  });
});
