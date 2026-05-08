// Fallback news for the ticker + dashboard feed when /api/news is
// unreachable. The live source is Google News RSS via /api/news; this
// file exists only so the page never renders empty during a brief
// upstream outage. Both consumers fetch the API first and only fall
// back here if the response is unusable.

export const TEAM_NEWS_FALLBACK = [
  { team: null, flag: '🏆', text: 'FIFA World Cup 26 — group draws complete, knockouts loading' },
  { team: null, flag: '🏆', text: 'Squads being announced across all 48 nations' },
  { team: null, flag: '🏆', text: 'Loading the latest team news…' },
];

export const ARTICLES_FALLBACK = [
  {
    id: 'fb-01', team: 'World Cup', flag: '🏆', source: 'FIFA',
    title: 'Official 2026 FIFA World Cup hub — fixtures, news, squads',
    url: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
  },
  {
    id: 'fb-02', team: 'World Cup', flag: '🏆', source: 'BBC Sport',
    title: 'BBC Sport — World Cup coverage and team analysis',
    url: 'https://www.bbc.com/sport/football/world-cup',
  },
  {
    id: 'fb-03', team: 'World Cup', flag: '🏆', source: 'ESPN',
    title: 'ESPN — World Cup hub with scores, standings, and reports',
    url: 'https://www.espn.com/soccer/fifa-world-cup/',
  },
];
