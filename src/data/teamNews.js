// FIFA World Cup 2026 — team news for the marquee ticker (non-clickable)
// and the dashboard feed (clickable, capped at 3 per day).
//
// Ticker items are short, present-tense, team-specific blurbs. The component
// renders them as plain text — no anchors — so users never leave the site.
//
// Dashboard articles are deterministic per calendar day: hash today's date
// and pick three from the pool. URLs target stable hub pages on official
// outlets (FIFA, ESPN, BBC, The Guardian, Sky Sports) so links don't rot.

export const TEAM_NEWS_TICKER = [
  { team: 'Argentina',   flag: '🇦🇷', text: 'Messi confirmed in 30-man provisional roster' },
  { team: 'France',      flag: '🇫🇷', text: 'Mbappé named captain for opening fixture' },
  { team: 'Brazil',      flag: '🇧🇷', text: 'Vinícius Jr cleared after minor knock in training' },
  { team: 'England',     flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', text: 'Bellingham fit for opener, Kane to lead the line' },
  { team: 'Spain',       flag: '🇪🇸', text: 'Yamal headlines youthful 26-man squad' },
  { team: 'Germany',     flag: '🇩🇪', text: 'Nagelsmann finalises midfield ahead of group stage' },
  { team: 'Portugal',    flag: '🇵🇹', text: 'Ronaldo arrives at training base in Toronto' },
  { team: 'Netherlands', flag: '🇳🇱', text: 'Koeman recalls De Jong after club-form surge' },
  { team: 'USA',         flag: '🇺🇸', text: 'Pulisic captains hosts in pre-tournament friendly win' },
  { team: 'Mexico',      flag: '🇲🇽', text: 'El Tri finalises Estadio Azteca walkthrough' },
  { team: 'Canada',      flag: '🇨🇦', text: 'Davies passes late fitness test, named to squad' },
  { team: 'Croatia',     flag: '🇭🇷', text: 'Modrić extends international career for one last run' },
  { team: 'Belgium',     flag: '🇧🇪', text: 'De Bruyne returns to full training after rest week' },
  { team: 'Morocco',     flag: '🇲🇦', text: 'Hakimi, Ziyech anchor Atlas Lions roster' },
  { team: 'Japan',       flag: '🇯🇵', text: 'Mitoma fit; Moriyasu locks in 4-2-3-1 shape' },
  { team: 'Senegal',     flag: '🇸🇳', text: 'Mané leads Lions of Teranga into base camp' },
  { team: 'Uruguay',     flag: '🇺🇾', text: 'Bielsa names Valverde, Núñez in attacking core' },
  { team: 'Colombia',    flag: '🇨🇴', text: 'James Rodríguez handed playmaker keys once more' },
  { team: 'Switzerland', flag: '🇨🇭', text: 'Xhaka recovered from calf strain, captain confirmed' },
  { team: 'Australia',   flag: '🇦🇺', text: 'Socceroos call up three uncapped A-League standouts' },
];

const ARTICLE_POOL = [
  {
    id: 'a01', team: 'Argentina', flag: '🇦🇷', source: 'FIFA',
    title: 'Argentina arrive in Houston ahead of opener — Scaloni hints at lineup',
    url: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
  },
  {
    id: 'a02', team: 'France', flag: '🇫🇷', source: 'ESPN',
    title: 'Mbappé: "This is the squad to win it all"',
    url: 'https://www.espn.com/soccer/fifa-world-cup/',
  },
  {
    id: 'a03', team: 'Brazil', flag: '🇧🇷', source: 'BBC Sport',
    title: 'Brazil settle into Los Angeles training base, Endrick impresses',
    url: 'https://www.bbc.com/sport/football/world-cup',
  },
  {
    id: 'a04', team: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', source: 'The Guardian',
    title: 'Tuchel names final 26: Bellingham, Foden, Saka all selected',
    url: 'https://www.theguardian.com/football/world-cup-2026',
  },
  {
    id: 'a05', team: 'Spain', flag: '🇪🇸', source: 'Sky Sports',
    title: 'Spain build group-stage plan around Lamine Yamal',
    url: 'https://www.skysports.com/world-cup',
  },
  {
    id: 'a06', team: 'Germany', flag: '🇩🇪', source: 'FIFA',
    title: 'Germany announce final 26 — Wirtz, Musiala headline midfield',
    url: 'https://www.fifa.com/en/news',
  },
  {
    id: 'a07', team: 'Portugal', flag: '🇵🇹', source: 'ESPN',
    title: 'Ronaldo named in record-setting sixth World Cup squad',
    url: 'https://www.espn.com/soccer/fifa-world-cup/',
  },
  {
    id: 'a08', team: 'Netherlands', flag: '🇳🇱', source: 'BBC Sport',
    title: 'Koeman backs Oranje to peak in knockout rounds',
    url: 'https://www.bbc.com/sport/football/world-cup',
  },
  {
    id: 'a09', team: 'USA', flag: '🇺🇸', source: 'The Athletic',
    title: 'Pochettino prepares USMNT for opening match at SoFi Stadium',
    url: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
  },
  {
    id: 'a10', team: 'Mexico', flag: '🇲🇽', source: 'FIFA',
    title: 'El Tri unveil 2026 home kit ahead of Azteca opener',
    url: 'https://www.fifa.com/en/news',
  },
  {
    id: 'a11', team: 'Canada', flag: '🇨🇦', source: 'Sky Sports',
    title: 'Alphonso Davies fit, will lead Canada at home tournament',
    url: 'https://www.skysports.com/world-cup',
  },
  {
    id: 'a12', team: 'Croatia', flag: '🇭🇷', source: 'The Guardian',
    title: 'Modrić, Kovačić anchor Croatia’s veteran midfield one last time',
    url: 'https://www.theguardian.com/football/world-cup-2026',
  },
  {
    id: 'a13', team: 'Morocco', flag: '🇲🇦', source: 'BBC Sport',
    title: 'Atlas Lions look to repeat 2022 heroics under Regragui',
    url: 'https://www.bbc.com/sport/football/world-cup',
  },
  {
    id: 'a14', team: 'Japan', flag: '🇯🇵', source: 'ESPN',
    title: 'Japan target deep run with Mitoma, Kubo at peak form',
    url: 'https://www.espn.com/soccer/fifa-world-cup/',
  },
  {
    id: 'a15', team: 'Belgium', flag: '🇧🇪', source: 'FIFA',
    title: 'De Bruyne returns from injury in time for World Cup opener',
    url: 'https://www.fifa.com/en/news',
  },
  {
    id: 'a16', team: 'Senegal', flag: '🇸🇳', source: 'The Athletic',
    title: 'Senegal arrive at training base in New Jersey, Mané on top form',
    url: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
  },
  {
    id: 'a17', team: 'Uruguay', flag: '🇺🇾', source: 'Sky Sports',
    title: 'Bielsa names tactically flexible 26-man Uruguay squad',
    url: 'https://www.skysports.com/world-cup',
  },
  {
    id: 'a18', team: 'Colombia', flag: '🇨🇴', source: 'BBC Sport',
    title: 'Colombia ride momentum from Copa final into World Cup',
    url: 'https://www.bbc.com/sport/football/world-cup',
  },
  {
    id: 'a19', team: 'Switzerland', flag: '🇨🇭', source: 'The Guardian',
    title: 'Yakin sticks with proven core, hands Embolo attacking lead',
    url: 'https://www.theguardian.com/football/world-cup-2026',
  },
  {
    id: 'a20', team: 'Australia', flag: '🇦🇺', source: 'ESPN',
    title: 'Socceroos finalise tactical plan for group-stage opener',
    url: 'https://www.espn.com/soccer/fifa-world-cup/',
  },
  {
    id: 'a21', team: 'Norway', flag: '🇳🇴', source: 'FIFA',
    title: 'Haaland, Ødegaard headline Norway’s first World Cup since 1998',
    url: 'https://www.fifa.com/en/news',
  },
];

function dateSeed(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return y * 10000 + m * 100 + day;
}

// Deterministic per-day rotation: same date → same three articles for every
// visitor. Cycles through the pool so the feed turns over week to week.
export function getDailyArticles(date = new Date(), count = 3) {
  if (ARTICLE_POOL.length === 0) return [];
  const seed = dateSeed(date);
  const start = (seed * 3) % ARTICLE_POOL.length;
  const out = [];
  for (let i = 0; i < Math.min(count, ARTICLE_POOL.length); i++) {
    out.push(ARTICLE_POOL[(start + i) % ARTICLE_POOL.length]);
  }
  return out;
}

export const ARTICLE_POOL_SIZE = ARTICLE_POOL.length;
