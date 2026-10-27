import { SwrCache } from './swr-cache';

describe('SwrCache', () => {
  it('returns nothing cached on the first load and caches the fresh value', async () => {
    // Arrange
    const cache = new SwrCache();

    // Act
    const { cached, fresh } = cache.load('project:PAY', () => Promise.resolve({ name: 'Payments' }));

    // Assert
    expect(cached).toBeUndefined();
    expect(await fresh).toEqual({ name: 'Payments' });
    expect(cache.get('project:PAY')).toEqual({ name: 'Payments' });
  });

  it('returns the cached value at once and replaces it with the fresh one', async () => {
    // Arrange
    const cache = new SwrCache();
    cache.set('project:PAY', { name: 'Old' });

    // Act
    const { cached, fresh } = cache.load('project:PAY', () => Promise.resolve({ name: 'New' }));

    // Assert
    expect(cached).toEqual({ name: 'Old' });
    expect(await fresh).toEqual({ name: 'New' });
    expect(cache.get('project:PAY')).toEqual({ name: 'New' });
  });

  it('reports a background revalidation only while cached data is shown', async () => {
    // Arrange
    const cache = new SwrCache();
    let resolve!: (value: number) => void;
    const first = cache.load('a', () => Promise.resolve(1));
    await first.fresh;

    // Act
    const second = cache.load('a', () => new Promise<number>((r) => (resolve = r)));
    const during = cache.revalidating();
    resolve(2);
    await second.fresh;

    // Assert
    expect(during).toBe(true);
    expect(cache.revalidating()).toBe(false);
  });

  it('keeps the cached value and stops revalidating when the refetch fails', async () => {
    // Arrange
    const cache = new SwrCache();
    cache.set('a', 1);

    // Act
    const { fresh } = cache.load<number>('a', () => Promise.reject(new Error('offline')));

    // Assert
    await expect(fresh).rejects.toThrow('offline');
    expect(cache.get('a')).toBe(1);
    expect(cache.revalidating()).toBe(false);
  });

  it('drops the entries carrying an invalidated tag', () => {
    // Arrange
    const cache = new SwrCache();
    cache.set('backlog:PAY', [1], ['project:PAY']);
    cache.set('backlog:WEB', [2], ['project:WEB']);
    cache.set('my-work', [3], ['my-work']);

    // Act
    cache.invalidate('project:PAY');

    // Assert
    expect(cache.get('backlog:PAY')).toBeUndefined();
    expect(cache.get('backlog:WEB')).toEqual([2]);
    expect(cache.get('my-work')).toEqual([3]);
  });

  it('evicts the least recently stored entry beyond its capacity', () => {
    // Arrange
    const cache = new SwrCache();

    // Act
    for (let i = 0; i <= 50; i++) cache.set(`k${i}`, i);

    // Assert
    expect(cache.get('k0')).toBeUndefined();
    expect(cache.get('k50')).toBe(50);
  });
});
