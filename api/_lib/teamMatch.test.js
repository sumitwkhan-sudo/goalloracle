/**
 * teamMatch — provider name reconciliation. The South Korea ("Korea
 * Republic") case is the bug this fixes: a finished game silently never
 * ingested because the provider's FIFA-official name didn't substring-match.
 */
import { describe, test, expect } from 'vitest';
import { teamNameMatches, normalizeTeamName } from './teamMatch.js';

describe('normalizeTeamName', () => {
  test('folds accents and punctuation', () => {
    expect(normalizeTeamName("Côte d'Ivoire")).toBe('cote d ivoire');
    expect(normalizeTeamName('Türkiye')).toBe('turkiye');
    expect(normalizeTeamName('Curaçao')).toBe('curacao');
  });
  test('drops noise tokens', () => {
    expect(normalizeTeamName('IR Iran')).toBe('iran');
    expect(normalizeTeamName('Korea Republic')).toBe('korea');
  });
});

describe('teamNameMatches', () => {
  test('alias: South Korea ↔ Korea Republic (the regression)', () => {
    expect(teamNameMatches('South Korea', 'Korea Republic')).toBe(true);
    expect(teamNameMatches('South Korea', 'Republic of Korea')).toBe(true);
  });
  test('alias: common ↔ official names', () => {
    expect(teamNameMatches('USA', 'United States')).toBe(true);
    expect(teamNameMatches('Iran', 'IR Iran')).toBe(true);
    expect(teamNameMatches('Türkiye', 'Turkey')).toBe(true);
    expect(teamNameMatches('Czechia', 'Czech Republic')).toBe(true);
    expect(teamNameMatches('Ivory Coast', "Côte d'Ivoire")).toBe(true);
    expect(teamNameMatches('Cape Verde', 'Cabo Verde')).toBe(true);
    expect(teamNameMatches('DR Congo', 'Congo DR')).toBe(true);
  });
  test('identical / trivial names still match', () => {
    expect(teamNameMatches('Mexico', 'Mexico')).toBe(true);
    expect(teamNameMatches('Brazil', 'Brazil')).toBe(true);
  });
  test('does not cross-match different teams', () => {
    expect(teamNameMatches('South Korea', 'Czechia')).toBe(false);
    expect(teamNameMatches('Mexico', 'South Africa')).toBe(false);
    expect(teamNameMatches('Spain', 'Portugal')).toBe(false);
  });
  test('empty/blank provider name never matches', () => {
    expect(teamNameMatches('Mexico', '')).toBe(false);
    expect(teamNameMatches('Mexico', null)).toBe(false);
  });
});
