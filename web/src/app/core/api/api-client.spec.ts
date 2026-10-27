import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client';

describe('ApiClient GET dedupe', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shares one request between identical GETs in flight', async () => {
    // Arrange
    const first = firstValueFrom(api.get<{ key: string }>('/projects/PAY'));
    const second = firstValueFrom(api.get<{ key: string }>('/projects/PAY'));

    // Act
    const requests = http.match('/api/v1/projects/PAY');
    requests[0].flush({ key: 'PAY' });

    // Assert
    expect(requests).toHaveLength(1);
    expect(await first).toEqual({ key: 'PAY' });
    expect(await second).toEqual({ key: 'PAY' });
  });

  it('sends separate requests for different query strings', () => {
    // Arrange
    void firstValueFrom(api.get('/projects', { limit: 100 }));
    void firstValueFrom(api.get('/projects', { limit: 25 }));

    // Act
    const requests = http.match((r) => r.url === '/api/v1/projects');

    // Assert
    expect(requests.map((r) => r.request.params.get('limit'))).toEqual(['100', '25']);
    requests.forEach((r) => r.flush({ items: [], nextCursor: null }));
  });

  it('starts a new request once the previous one completed', async () => {
    // Arrange
    const first = firstValueFrom(api.get('/me'));
    http.expectOne('/api/v1/me').flush({ id: 1 });
    await first;

    // Act
    const second = firstValueFrom(api.get('/me'));
    http.expectOne('/api/v1/me').flush({ id: 2 });

    // Assert
    expect(await second).toEqual({ id: 2 });
  });

  it('does not let a GET issued after a write join one started before it', () => {
    // Arrange
    void firstValueFrom(api.get('/tickets/PAY-1'));
    void firstValueFrom(api.patch('/tickets/PAY-1', { title: 'New' }));

    // Act
    void firstValueFrom(api.get('/tickets/PAY-1'));

    // Assert
    const gets = http.match((r) => r.method === 'GET' && r.url === '/api/v1/tickets/PAY-1');
    expect(gets).toHaveLength(2);
    gets.forEach((r) => r.flush({}));
    http.expectOne((r) => r.method === 'PATCH').flush({});
  });

  it('shares an in-flight GET even when one subscriber errors out on the other', async () => {
    // Arrange
    const first = firstValueFrom(api.get('/tickets/NOPE-1'));
    const second = firstValueFrom(api.get('/tickets/NOPE-1'));

    // Act
    http.expectOne('/api/v1/tickets/NOPE-1').flush(null, { status: 404, statusText: 'Not Found' });

    // Assert
    await expect(first).rejects.toBeTruthy();
    await expect(second).rejects.toBeTruthy();
  });
});
