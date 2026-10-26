import vectors from '../../../../../docs/architecture/flag-bucketing-vectors.json';
import { flagBucket, isInRollout } from './flag-bucketing';

interface Vector {
  flagKey: string;
  userId: string;
  bucket: number;
}

describe('flagBucket', () => {
  it.each(vectors as Vector[])(
    '$flagKey / $userId → $bucket',
    async ({ flagKey, userId, bucket }) => {
      // Act
      const result = await flagBucket(flagKey, userId);

      // Assert
      expect(result).toBe(bucket);
    },
  );

  it('puts a user in the rollout when the bucket is below the percentage', async () => {
    // Arrange
    const { flagKey, userId, bucket } = (vectors as Vector[])[0];

    // Act & Assert
    expect(await isInRollout(flagKey, userId, bucket + 1)).toBe(true);
    expect(await isInRollout(flagKey, userId, bucket)).toBe(false);
    expect(await isInRollout(flagKey, userId, 0)).toBe(false);
    expect(await isInRollout(flagKey, userId, 100)).toBe(true);
  });
});
