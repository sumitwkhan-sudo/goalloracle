// FIFA World Cup 2026 — All 104 Matches
// 48 teams, 12 groups of 4, USA/Canada/Mexico

const WORLD_CUP_MATCHES = [
  // === GROUP STAGE — MATCHDAY 1 ===
  // Group A
  { id: 'wc001', stage: 'Group A', home: 'Mexico', away: 'South Africa', homeFlag: '🇲🇽', awayFlag: '🇿🇦', date: '2026-06-11', time: '18:00', venue: 'Estadio Azteca', city: 'Mexico City', isKnockout: false },
  { id: 'wc002', stage: 'Group A', home: 'Indonesia', away: 'Colombia', homeFlag: '🇮🇩', awayFlag: '🇨🇴', date: '2026-06-11', time: '21:00', venue: 'Estadio Azteca', city: 'Mexico City', isKnockout: false },
  // Group B
  { id: 'wc003', stage: 'Group B', home: 'Portugal', away: 'Bahrain', homeFlag: '🇵🇹', awayFlag: '🇧🇭', date: '2026-06-12', time: '13:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc004', stage: 'Group B', home: 'Bolivia', away: 'Ecuador', homeFlag: '🇧🇴', awayFlag: '🇪🇨', date: '2026-06-12', time: '16:00', venue: 'Gillette Stadium', city: 'Boston', isKnockout: false },
  // Group C
  { id: 'wc005', stage: 'Group C', home: 'Belgium', away: 'Qatar', homeFlag: '🇧🇪', awayFlag: '🇶🇦', date: '2026-06-12', time: '19:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc006', stage: 'Group C', home: 'Iran', away: 'Honduras', homeFlag: '🇮🇷', awayFlag: '🇭🇳', date: '2026-06-12', time: '22:00', venue: 'NRG Stadium', city: 'Houston', isKnockout: false },
  // Group D
  { id: 'wc007', stage: 'Group D', home: 'USA', away: 'Paraguay', homeFlag: '🇺🇸', awayFlag: '🇵🇾', date: '2026-06-13', time: '17:00', venue: 'SoFi Stadium', city: 'Los Angeles', isKnockout: false },
  { id: 'wc008', stage: 'Group D', home: 'Australia', away: 'TBD (Playoff)', homeFlag: '🇦🇺', awayFlag: '🏳️', date: '2026-06-13', time: '20:00', venue: 'AT&T Stadium', city: 'Dallas', isKnockout: false },
  // Group E
  { id: 'wc009', stage: 'Group E', home: 'Brazil', away: 'New Zealand', homeFlag: '🇧🇷', awayFlag: '🇳🇿', date: '2026-06-13', time: '14:00', venue: 'Rose Bowl', city: 'Los Angeles', isKnockout: false },
  { id: 'wc010', stage: 'Group E', home: 'Turkey', away: 'Costa Rica', homeFlag: '🇹🇷', awayFlag: '🇨🇷', date: '2026-06-13', time: '22:00', venue: 'Mercedes-Benz Stadium', city: 'Atlanta', isKnockout: false },
  // Group F
  { id: 'wc011', stage: 'Group F', home: 'Argentina', away: 'Peru', homeFlag: '🇦🇷', awayFlag: '🇵🇪', date: '2026-06-14', time: '17:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc012', stage: 'Group F', home: 'Canada', away: 'Cameroon', homeFlag: '🇨🇦', awayFlag: '🇨🇲', date: '2026-06-14', time: '20:00', venue: 'BMO Field', city: 'Toronto', isKnockout: false },
  // Group G
  { id: 'wc013', stage: 'Group G', home: 'Germany', away: 'Uruguay', homeFlag: '🇩🇪', awayFlag: '🇺🇾', date: '2026-06-14', time: '14:00', venue: 'Lincoln Financial Field', city: 'Philadelphia', isKnockout: false },
  { id: 'wc014', stage: 'Group G', home: 'Japan', away: 'TBD (Playoff)', homeFlag: '🇯🇵', awayFlag: '🏳️', date: '2026-06-14', time: '22:00', venue: 'Lumen Field', city: 'Seattle', isKnockout: false },
  // Group H
  { id: 'wc015', stage: 'Group H', home: 'Spain', away: 'Panama', homeFlag: '🇪🇸', awayFlag: '🇵🇦', date: '2026-06-15', time: '14:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc016', stage: 'Group H', home: 'South Korea', away: 'Serbia', homeFlag: '🇰🇷', awayFlag: '🇷🇸', date: '2026-06-15', time: '17:00', venue: "Levi's Stadium", city: 'San Francisco', isKnockout: false },
  // Group I
  { id: 'wc017', stage: 'Group I', home: 'France', away: 'Senegal', homeFlag: '🇫🇷', awayFlag: '🇸🇳', date: '2026-06-15', time: '20:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc018', stage: 'Group I', home: 'Norway', away: 'TBD (Playoff)', homeFlag: '🇳🇴', awayFlag: '🏳️', date: '2026-06-15', time: '22:00', venue: 'BC Place', city: 'Vancouver', isKnockout: false },
  // Group J
  { id: 'wc019', stage: 'Group J', home: 'Netherlands', away: 'Saudi Arabia', homeFlag: '🇳🇱', awayFlag: '🇸🇦', date: '2026-06-16', time: '14:00', venue: 'Gillette Stadium', city: 'Boston', isKnockout: false },
  { id: 'wc020', stage: 'Group J', home: 'Ivory Coast', away: 'Chile', homeFlag: '🇨🇮', awayFlag: '🇨🇱', date: '2026-06-16', time: '17:00', venue: 'Mercedes-Benz Stadium', city: 'Atlanta', isKnockout: false },
  // Group K
  { id: 'wc021', stage: 'Group K', home: 'Italy', away: 'Albania', homeFlag: '🇮🇹', awayFlag: '🇦🇱', date: '2026-06-16', time: '20:00', venue: 'SoFi Stadium', city: 'Los Angeles', isKnockout: false },
  { id: 'wc022', stage: 'Group K', home: 'Morocco', away: 'Guatemala', homeFlag: '🇲🇦', awayFlag: '🇬🇹', date: '2026-06-16', time: '22:00', venue: 'Estadio BBVA', city: 'Monterrey', isKnockout: false },
  // Group L
  { id: 'wc023', stage: 'Group L', home: 'England', away: 'Croatia', homeFlag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', awayFlag: '🇭🇷', date: '2026-06-17', time: '17:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc024', stage: 'Group L', home: 'Ghana', away: 'Wales', homeFlag: '🇬🇭', awayFlag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', date: '2026-06-17', time: '20:00', venue: 'Lincoln Financial Field', city: 'Philadelphia', isKnockout: false },

  // === GROUP STAGE — MATCHDAY 2 ===
  { id: 'wc025', stage: 'Group A', home: 'Mexico', away: 'Indonesia', homeFlag: '🇲🇽', awayFlag: '🇮🇩', date: '2026-06-17', time: '14:00', venue: 'Estadio Azteca', city: 'Mexico City', isKnockout: false },
  { id: 'wc026', stage: 'Group A', home: 'South Africa', away: 'Colombia', homeFlag: '🇿🇦', awayFlag: '🇨🇴', date: '2026-06-17', time: '22:00', venue: 'Estadio Akron', city: 'Guadalajara', isKnockout: false },
  { id: 'wc027', stage: 'Group B', home: 'Portugal', away: 'Bolivia', homeFlag: '🇵🇹', awayFlag: '🇧🇴', date: '2026-06-18', time: '14:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc028', stage: 'Group B', home: 'Bahrain', away: 'Ecuador', homeFlag: '🇧🇭', awayFlag: '🇪🇨', date: '2026-06-18', time: '17:00', venue: 'Gillette Stadium', city: 'Boston', isKnockout: false },
  { id: 'wc029', stage: 'Group C', home: 'Belgium', away: 'Iran', homeFlag: '🇧🇪', awayFlag: '🇮🇷', date: '2026-06-18', time: '20:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc030', stage: 'Group C', home: 'Qatar', away: 'Honduras', homeFlag: '🇶🇦', awayFlag: '🇭🇳', date: '2026-06-18', time: '22:00', venue: 'NRG Stadium', city: 'Houston', isKnockout: false },
  { id: 'wc031', stage: 'Group D', home: 'USA', away: 'Australia', homeFlag: '🇺🇸', awayFlag: '🇦🇺', date: '2026-06-19', time: '17:00', venue: 'SoFi Stadium', city: 'Los Angeles', isKnockout: false },
  { id: 'wc032', stage: 'Group D', home: 'Paraguay', away: 'TBD (Playoff)', homeFlag: '🇵🇾', awayFlag: '🏳️', date: '2026-06-19', time: '20:00', venue: 'AT&T Stadium', city: 'Dallas', isKnockout: false },
  { id: 'wc033', stage: 'Group E', home: 'Brazil', away: 'Turkey', homeFlag: '🇧🇷', awayFlag: '🇹🇷', date: '2026-06-19', time: '14:00', venue: 'Rose Bowl', city: 'Los Angeles', isKnockout: false },
  { id: 'wc034', stage: 'Group E', home: 'New Zealand', away: 'Costa Rica', homeFlag: '🇳🇿', awayFlag: '🇨🇷', date: '2026-06-19', time: '22:00', venue: 'Mercedes-Benz Stadium', city: 'Atlanta', isKnockout: false },
  { id: 'wc035', stage: 'Group F', home: 'Argentina', away: 'Canada', homeFlag: '🇦🇷', awayFlag: '🇨🇦', date: '2026-06-20', time: '17:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc036', stage: 'Group F', home: 'Peru', away: 'Cameroon', homeFlag: '🇵🇪', awayFlag: '🇨🇲', date: '2026-06-20', time: '20:00', venue: 'BMO Field', city: 'Toronto', isKnockout: false },
  { id: 'wc037', stage: 'Group G', home: 'Germany', away: 'Japan', homeFlag: '🇩🇪', awayFlag: '🇯🇵', date: '2026-06-20', time: '14:00', venue: 'Lincoln Financial Field', city: 'Philadelphia', isKnockout: false },
  { id: 'wc038', stage: 'Group G', home: 'Uruguay', away: 'TBD (Playoff)', homeFlag: '🇺🇾', awayFlag: '🏳️', date: '2026-06-20', time: '22:00', venue: 'Lumen Field', city: 'Seattle', isKnockout: false },
  { id: 'wc039', stage: 'Group H', home: 'Spain', away: 'South Korea', homeFlag: '🇪🇸', awayFlag: '🇰🇷', date: '2026-06-21', time: '14:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc040', stage: 'Group H', home: 'Panama', away: 'Serbia', homeFlag: '🇵🇦', awayFlag: '🇷🇸', date: '2026-06-21', time: '17:00', venue: "Levi's Stadium", city: 'San Francisco', isKnockout: false },
  { id: 'wc041', stage: 'Group I', home: 'France', away: 'Norway', homeFlag: '🇫🇷', awayFlag: '🇳🇴', date: '2026-06-21', time: '20:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc042', stage: 'Group I', home: 'Senegal', away: 'TBD (Playoff)', homeFlag: '🇸🇳', awayFlag: '🏳️', date: '2026-06-21', time: '22:00', venue: 'BC Place', city: 'Vancouver', isKnockout: false },
  { id: 'wc043', stage: 'Group J', home: 'Netherlands', away: 'Ivory Coast', homeFlag: '🇳🇱', awayFlag: '🇨🇮', date: '2026-06-22', time: '14:00', venue: 'Gillette Stadium', city: 'Boston', isKnockout: false },
  { id: 'wc044', stage: 'Group J', home: 'Saudi Arabia', away: 'Chile', homeFlag: '🇸🇦', awayFlag: '🇨🇱', date: '2026-06-22', time: '17:00', venue: 'Mercedes-Benz Stadium', city: 'Atlanta', isKnockout: false },
  { id: 'wc045', stage: 'Group K', home: 'Italy', away: 'Morocco', homeFlag: '🇮🇹', awayFlag: '🇲🇦', date: '2026-06-22', time: '20:00', venue: 'SoFi Stadium', city: 'Los Angeles', isKnockout: false },
  { id: 'wc046', stage: 'Group K', home: 'Albania', away: 'Guatemala', homeFlag: '🇦🇱', awayFlag: '🇬🇹', date: '2026-06-22', time: '22:00', venue: 'Estadio BBVA', city: 'Monterrey', isKnockout: false },
  { id: 'wc047', stage: 'Group L', home: 'England', away: 'Ghana', homeFlag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', awayFlag: '🇬🇭', date: '2026-06-23', time: '17:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc048', stage: 'Group L', home: 'Croatia', away: 'Wales', homeFlag: '🇭🇷', awayFlag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', date: '2026-06-23', time: '20:00', venue: 'Lincoln Financial Field', city: 'Philadelphia', isKnockout: false },

  // === GROUP STAGE — MATCHDAY 3 ===
  { id: 'wc049', stage: 'Group A', home: 'Colombia', away: 'Mexico', homeFlag: '🇨🇴', awayFlag: '🇲🇽', date: '2026-06-25', time: '18:00', venue: 'Estadio Azteca', city: 'Mexico City', isKnockout: false },
  { id: 'wc050', stage: 'Group A', home: 'South Africa', away: 'Indonesia', homeFlag: '🇿🇦', awayFlag: '🇮🇩', date: '2026-06-25', time: '18:00', venue: 'Estadio Akron', city: 'Guadalajara', isKnockout: false },
  { id: 'wc051', stage: 'Group B', home: 'Ecuador', away: 'Portugal', homeFlag: '🇪🇨', awayFlag: '🇵🇹', date: '2026-06-25', time: '21:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc052', stage: 'Group B', home: 'Bahrain', away: 'Bolivia', homeFlag: '🇧🇭', awayFlag: '🇧🇴', date: '2026-06-25', time: '21:00', venue: 'Gillette Stadium', city: 'Boston', isKnockout: false },
  { id: 'wc053', stage: 'Group C', home: 'Honduras', away: 'Belgium', homeFlag: '🇭🇳', awayFlag: '🇧🇪', date: '2026-06-26', time: '18:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc054', stage: 'Group C', home: 'Qatar', away: 'Iran', homeFlag: '🇶🇦', awayFlag: '🇮🇷', date: '2026-06-26', time: '18:00', venue: 'NRG Stadium', city: 'Houston', isKnockout: false },
  { id: 'wc055', stage: 'Group D', home: 'TBD (Playoff)', away: 'USA', homeFlag: '🏳️', awayFlag: '🇺🇸', date: '2026-06-26', time: '21:00', venue: 'SoFi Stadium', city: 'Los Angeles', isKnockout: false },
  { id: 'wc056', stage: 'Group D', home: 'Australia', away: 'Paraguay', homeFlag: '🇦🇺', awayFlag: '🇵🇾', date: '2026-06-26', time: '21:00', venue: 'AT&T Stadium', city: 'Dallas', isKnockout: false },
  { id: 'wc057', stage: 'Group E', home: 'Costa Rica', away: 'Brazil', homeFlag: '🇨🇷', awayFlag: '🇧🇷', date: '2026-06-27', time: '18:00', venue: 'Rose Bowl', city: 'Los Angeles', isKnockout: false },
  { id: 'wc058', stage: 'Group E', home: 'New Zealand', away: 'Turkey', homeFlag: '🇳🇿', awayFlag: '🇹🇷', date: '2026-06-27', time: '18:00', venue: 'Mercedes-Benz Stadium', city: 'Atlanta', isKnockout: false },
  { id: 'wc059', stage: 'Group F', home: 'Cameroon', away: 'Argentina', homeFlag: '🇨🇲', awayFlag: '🇦🇷', date: '2026-06-27', time: '21:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc060', stage: 'Group F', home: 'Peru', away: 'Canada', homeFlag: '🇵🇪', awayFlag: '🇨🇦', date: '2026-06-27', time: '21:00', venue: 'BMO Field', city: 'Toronto', isKnockout: false },
  { id: 'wc061', stage: 'Group G', home: 'TBD (Playoff)', away: 'Germany', homeFlag: '🏳️', awayFlag: '🇩🇪', date: '2026-06-28', time: '18:00', venue: 'Lincoln Financial Field', city: 'Philadelphia', isKnockout: false },
  { id: 'wc062', stage: 'Group G', home: 'Uruguay', away: 'Japan', homeFlag: '🇺🇾', awayFlag: '🇯🇵', date: '2026-06-28', time: '18:00', venue: 'Lumen Field', city: 'Seattle', isKnockout: false },
  { id: 'wc063', stage: 'Group H', home: 'Serbia', away: 'Spain', homeFlag: '🇷🇸', awayFlag: '🇪🇸', date: '2026-06-28', time: '21:00', venue: 'Hard Rock Stadium', city: 'Miami', isKnockout: false },
  { id: 'wc064', stage: 'Group H', home: 'Panama', away: 'South Korea', homeFlag: '🇵🇦', awayFlag: '🇰🇷', date: '2026-06-28', time: '21:00', venue: "Levi's Stadium", city: 'San Francisco', isKnockout: false },
  { id: 'wc065', stage: 'Group I', home: 'TBD (Playoff)', away: 'France', homeFlag: '🏳️', awayFlag: '🇫🇷', date: '2026-06-29', time: '18:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc066', stage: 'Group I', home: 'Senegal', away: 'Norway', homeFlag: '🇸🇳', awayFlag: '🇳🇴', date: '2026-06-29', time: '18:00', venue: 'BC Place', city: 'Vancouver', isKnockout: false },
  { id: 'wc067', stage: 'Group J', home: 'Chile', away: 'Netherlands', homeFlag: '🇨🇱', awayFlag: '🇳🇱', date: '2026-06-29', time: '21:00', venue: 'Gillette Stadium', city: 'Boston', isKnockout: false },
  { id: 'wc068', stage: 'Group J', home: 'Saudi Arabia', away: 'Ivory Coast', homeFlag: '🇸🇦', awayFlag: '🇨🇮', date: '2026-06-29', time: '21:00', venue: 'Mercedes-Benz Stadium', city: 'Atlanta', isKnockout: false },
  { id: 'wc069', stage: 'Group K', home: 'Guatemala', away: 'Italy', homeFlag: '🇬🇹', awayFlag: '🇮🇹', date: '2026-06-30', time: '18:00', venue: 'SoFi Stadium', city: 'Los Angeles', isKnockout: false },
  { id: 'wc070', stage: 'Group K', home: 'Albania', away: 'Morocco', homeFlag: '🇦🇱', awayFlag: '🇲🇦', date: '2026-06-30', time: '18:00', venue: 'Estadio BBVA', city: 'Monterrey', isKnockout: false },
  { id: 'wc071', stage: 'Group L', home: 'Wales', away: 'England', homeFlag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', awayFlag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', date: '2026-06-30', time: '21:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: false },
  { id: 'wc072', stage: 'Group L', home: 'Ghana', away: 'Croatia', homeFlag: '🇬🇭', awayFlag: '🇭🇷', date: '2026-06-30', time: '21:00', venue: 'Lincoln Financial Field', city: 'Philadelphia', isKnockout: false },

  // === ROUND OF 32 (16 matches) ===
  { id: 'wc073', stage: 'Round of 32', home: '1A', away: '2B', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-01', time: '14:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc074', stage: 'Round of 32', home: '1B', away: '2A', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-01', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc075', stage: 'Round of 32', home: '1C', away: '2D', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-01', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc076', stage: 'Round of 32', home: '1D', away: '2C', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-01', time: '22:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc077', stage: 'Round of 32', home: '1E', away: '2F', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-02', time: '14:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc078', stage: 'Round of 32', home: '1F', away: '2E', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-02', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc079', stage: 'Round of 32', home: '1G', away: '2H', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-02', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc080', stage: 'Round of 32', home: '1H', away: '2G', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-02', time: '22:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc081', stage: 'Round of 32', home: '1I', away: '2J', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-03', time: '14:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc082', stage: 'Round of 32', home: '1J', away: '2I', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-03', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc083', stage: 'Round of 32', home: '1K', away: '2L', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-03', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc084', stage: 'Round of 32', home: '1L', away: '2K', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-03', time: '22:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc085', stage: 'Round of 32', home: '3rd Place TBD', away: '3rd Place TBD', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-04', time: '14:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc086', stage: 'Round of 32', home: '3rd Place TBD', away: '3rd Place TBD', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-04', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc087', stage: 'Round of 32', home: '3rd Place TBD', away: '3rd Place TBD', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-04', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc088', stage: 'Round of 32', home: '3rd Place TBD', away: '3rd Place TBD', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-04', time: '22:00', venue: 'TBD', city: 'TBD', isKnockout: true },

  // === ROUND OF 16 (8 matches) ===
  { id: 'wc089', stage: 'Round of 16', home: 'W73', away: 'W74', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-06', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc090', stage: 'Round of 16', home: 'W75', away: 'W76', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-06', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc091', stage: 'Round of 16', home: 'W77', away: 'W78', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-07', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc092', stage: 'Round of 16', home: 'W79', away: 'W80', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-07', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc093', stage: 'Round of 16', home: 'W81', away: 'W82', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-08', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc094', stage: 'Round of 16', home: 'W83', away: 'W84', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-08', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc095', stage: 'Round of 16', home: 'W85', away: 'W86', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-09', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc096', stage: 'Round of 16', home: 'W87', away: 'W88', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-09', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },

  // === QUARTER-FINALS (4 matches) ===
  { id: 'wc097', stage: 'Quarter-Final', home: 'W89', away: 'W90', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-11', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc098', stage: 'Quarter-Final', home: 'W91', away: 'W92', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-11', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc099', stage: 'Quarter-Final', home: 'W93', away: 'W94', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-12', time: '17:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc100', stage: 'Quarter-Final', home: 'W95', away: 'W96', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-12', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },

  // === SEMI-FINALS (2 matches) ===
  { id: 'wc101', stage: 'Semi-Final', home: 'W97', away: 'W98', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-15', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },
  { id: 'wc102', stage: 'Semi-Final', home: 'W99', away: 'W100', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-16', time: '20:00', venue: 'TBD', city: 'TBD', isKnockout: true },

  // === 3RD PLACE PLAYOFF ===
  { id: 'wc103', stage: '3rd Place', home: 'L101', away: 'L102', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-18', time: '18:00', venue: 'TBD', city: 'TBD', isKnockout: true },

  // === FINAL ===
  { id: 'wc104', stage: 'Final', home: 'W101', away: 'W102', homeFlag: '🏳️', awayFlag: '🏳️', date: '2026-07-19', time: '20:00', venue: 'MetLife Stadium', city: 'New York/NJ', isKnockout: true },
];

export default WORLD_CUP_MATCHES;
