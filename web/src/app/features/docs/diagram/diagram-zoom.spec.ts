import { fitScale, nextZoom, ZOOM_MAX, ZOOM_MIN } from './diagram-zoom';

describe('fitScale', () => {
  it('shrinks a diagram to the narrower of the two limits', () => {
    // Act
    const byWidth = fitScale(1600, 400, 800, 600);
    const byHeight = fitScale(400, 1200, 800, 600);

    // Assert
    expect(byWidth).toBe(0.5);
    expect(byHeight).toBe(0.5);
  });

  it('never enlarges a small diagram and waits for a measured box', () => {
    // Act + Assert
    expect(fitScale(200, 100, 800, 600)).toBe(1);
    expect(fitScale(2000, 100, 0, 0)).toBe(1);
  });

  it('keeps a huge diagram readable at the minimum zoom', () => {
    // Act + Assert
    expect(fitScale(100_000, 100, 800, 600)).toBe(ZOOM_MIN);
  });
});

describe('nextZoom', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    // Act + Assert
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(nextZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it('moves a fitted scale between steps to the nearest step in that direction', () => {
    // Act + Assert
    expect(nextZoom(0.62, 1)).toBe(0.75);
    expect(nextZoom(0.62, -1)).toBe(0.5);
  });
});
