import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AVATAR_REFRESH_AFTER_MS, AvatarDirectory } from './avatar-directory';

const ANN = '0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B';
const BOB = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const URL = '/api/v1/users/avatars';

describe('AvatarDirectory', () => {
  let directory: AvatarDirectory;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    directory = TestBed.inject(AvatarDirectory);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function load(entries: { id: string; icon: string | null; color: string | null }[]) {
    const loading = directory.load();
    http.expectOne(URL).flush(entries);
    await loading;
  }

  it('joins the loaded avatars to user ids case-insensitively', async () => {
    // Act
    await load([{ id: ANN, icon: null, color: 'teal' }]);

    // Assert
    expect(directory.avatarOf(ANN.toLowerCase())).toEqual({ icon: null, color: 'teal' });
    expect(directory.avatarOf(BOB)).toBeNull();
  });

  it('loads the icon art once an avatar has an icon', async () => {
    // Act
    await load([{ id: ANN, icon: 'fox', color: null }]);
    await directory.ensureArt();

    // Assert
    expect(directory.artReady()).toBe(true);
    expect(directory.imageOf('fox')).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(directory.imageOf('dodo')).toBeNull();
  });

  it('refetches only when the data is older than five minutes', async () => {
    // Arrange
    await load([]);
    const now = Date.now();

    // Act
    await directory.refreshIfStale(now + AVATAR_REFRESH_AFTER_MS - 1000);
    http.expectNone(URL);
    const refreshing = directory.refreshIfStale(now + AVATAR_REFRESH_AFTER_MS + 1000);
    http.expectOne(URL).flush([{ id: BOB, icon: null, color: 'pink' }]);
    await refreshing;

    // Assert
    expect(directory.avatarOf(BOB)).toEqual({ icon: null, color: 'pink' });
  });

  it('does not refetch before the first load (signed out)', async () => {
    // Act
    await directory.refreshIfStale(Date.now() + AVATAR_REFRESH_AFTER_MS * 2);

    // Assert
    http.expectNone(URL);
  });

  it('shows an own save at once, and a fetch in flight cannot undo it', async () => {
    // Arrange
    await load([{ id: ANN, icon: null, color: 'teal' }]);
    const stale = directory.load();

    // Act
    directory.set(ANN, { icon: 'owl', color: 'amber' });
    http.expectOne(URL).flush([{ id: ANN, icon: null, color: 'teal' }]);
    await stale;

    // Assert
    expect(directory.avatarOf(ANN)).toEqual({ icon: 'owl', color: 'amber' });
  });

  it('drops a user set back to initials and the hashed colour', async () => {
    // Arrange
    await load([{ id: ANN, icon: 'owl', color: null }]);

    // Act
    directory.set(ANN, { icon: null, color: null });

    // Assert
    expect(directory.avatarOf(ANN)).toBeNull();
  });

  it('keeps what it shows when a fetch fails', async () => {
    // Arrange
    await load([{ id: ANN, icon: null, color: 'teal' }]);

    // Act
    const failing = directory.load();
    http.expectOne(URL).flush(null, { status: 500, statusText: 'Server Error' });
    await failing;

    // Assert
    expect(directory.avatarOf(ANN)).toEqual({ icon: null, color: 'teal' });
  });

  it('clears on sign-out and ignores a fetch that was in flight', async () => {
    // Arrange
    await load([{ id: ANN, icon: null, color: 'teal' }]);
    const inFlight = directory.load();

    // Act
    directory.clear();
    http.expectOne(URL).flush([{ id: BOB, icon: null, color: 'pink' }]);
    await inFlight;

    // Assert
    expect(directory.avatarOf(ANN)).toBeNull();
    expect(directory.avatarOf(BOB)).toBeNull();
  });
});
