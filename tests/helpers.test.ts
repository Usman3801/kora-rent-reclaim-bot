import { chunk, lamportsToSol, ageInDays, sleep } from '../src/utils/helpers';

describe('chunk', () => {
  test('should split array into chunks of specified size', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const result = chunk(arr, 3);
    expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  test('should handle empty array', () => {
    const result = chunk([], 3);
    expect(result).toEqual([]);
  });

  test('should handle array smaller than chunk size', () => {
    const arr = [1, 2];
    const result = chunk(arr, 5);
    expect(result).toEqual([[1, 2]]);
  });
});

describe('lamportsToSol', () => {
  test('should convert lamports to SOL with default decimals', () => {
    expect(lamportsToSol(1000000000)).toBe(1);
    expect(lamportsToSol(500000000)).toBe(0.5);
  });

  test('should handle zero', () => {
    expect(lamportsToSol(0)).toBe(0);
  });
});

describe('ageInDays', () => {
  test('should calculate age in days from Date object', () => {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const age = ageInDays(oneWeekAgo);
    expect(age).toBeCloseTo(7, 0);
  });

  test('should return small value for recent timestamp', () => {
    const now = new Date();
    const age = ageInDays(now);
    expect(age).toBeLessThan(0.01);
  });
});

describe('sleep', () => {
  test('should delay for specified milliseconds', async () => {
    const start = Date.now();
    await sleep(100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(200);
  });
});
