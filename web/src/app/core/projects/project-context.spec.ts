import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { SwrCache } from '../api/swr-cache';
import { ProjectContext, ProjectDetail } from './project-context';
import { ProjectDirectory } from './project-directory';

function project(name: string): ProjectDetail {
  return {
    id: 'p1',
    key: 'PAY',
    name,
    description: null,
    visibility: 'Public',
    myRole: 'Owner',
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    members: [],
    boards: [],
    rowVersion: 1,
  };
}

describe('ProjectContext', () => {
  let api: { get: ReturnType<typeof vi.fn> };
  let context: ProjectContext;

  beforeEach(() => {
    api = { get: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ProjectContext,
        { provide: ApiClient, useValue: api },
        { provide: ProjectDirectory, useValue: { byKey: () => undefined } },
      ],
    });
    context = TestBed.inject(ProjectContext);
  });

  it('fetches a project once however often load is called for the same key', async () => {
    // Arrange
    api.get.mockReturnValue(of(project('Payments')));

    // Act
    await context.load('pay');
    await context.load('PAY');
    await context.load('PAY');

    // Assert
    expect(api.get).toHaveBeenCalledOnce();
    expect(context.name()).toBe('Payments');
  });

  it('does not retry by itself after a 404 and reports not found', async () => {
    // Arrange
    api.get.mockReturnValue(throwError(() => new ApiError(404, 'project.notFound', 'Not found')));

    // Act
    await context.load('NOPE');
    await context.load('NOPE');

    // Assert
    expect(api.get).toHaveBeenCalledOnce();
    expect(context.notFound()).toBe(true);
    expect(context.project()).toBeNull();
  });

  it('shows the cached project at once and replaces it with the fresh one', async () => {
    // Arrange
    TestBed.inject(SwrCache).set('project:PAY', project('Old name'));
    const response = new Subject<ProjectDetail>();
    api.get.mockReturnValue(response);

    // Act
    const pending = context.load('PAY');
    const shown = context.project()?.name;
    response.next(project('New name'));
    response.complete();
    await pending;

    // Assert
    expect(shown).toBe('Old name');
    expect(context.status()).toBe('loaded');
    expect(context.project()?.name).toBe('New name');
  });
});
