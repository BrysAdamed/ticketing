import { ProjectSummary } from '@core/projects/project-directory';
import { countProjects, filterProjects } from './projects-list.store';

function project(key: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: key,
    key,
    name: `${key} project`,
    visibility: 'Private',
    myRole: 'Member',
    isMember: true,
    ...overrides,
  };
}

describe('project list filtering', () => {
  const projects = [
    project('WEB', { name: 'Website' }),
    project('OPEN', { visibility: 'Public', isMember: false, myRole: 'Member' }),
    project('JOINED', { visibility: 'Public' }),
    project('ADMIN', { isMember: false, myRole: 'Owner' }),
  ];

  it('treats Mine as explicit membership, not effective access', () => {
    // Act
    const mine = filterProjects(projects, '', 'mine').map((p) => p.key);

    // Assert
    expect(mine).toEqual(['WEB', 'JOINED']);
  });

  it('filters by visibility and by key or name text', () => {
    // Act / Assert
    expect(filterProjects(projects, '', 'public').map((p) => p.key)).toEqual(['OPEN', 'JOINED']);
    expect(filterProjects(projects, 'websi', 'all').map((p) => p.key)).toEqual(['WEB']);
    expect(filterProjects(projects, ' join ', 'public').map((p) => p.key)).toEqual(['JOINED']);
  });

  it('counts every segment', () => {
    // Act / Assert
    expect(countProjects(projects)).toEqual({ all: 4, mine: 2, public: 2, private: 2 });
  });
});
