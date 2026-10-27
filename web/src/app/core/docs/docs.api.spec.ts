import { fitsKeepalive, KEEPALIVE_MAX_BODY_BYTES } from './docs.api';

describe('fitsKeepalive', () => {
  it('measures the body in UTF-8 bytes against the keepalive limit', () => {
    // Act + Assert
    expect(fitsKeepalive('x'.repeat(KEEPALIVE_MAX_BODY_BYTES))).toBe(true);
    expect(fitsKeepalive('x'.repeat(KEEPALIVE_MAX_BODY_BYTES + 1))).toBe(false);
    expect(fitsKeepalive('ł'.repeat(KEEPALIVE_MAX_BODY_BYTES / 2))).toBe(true);
    expect(fitsKeepalive('ł'.repeat(KEEPALIVE_MAX_BODY_BYTES / 2 + 1))).toBe(false);
  });
});
