import React, { useState, useEffect } from 'react';
import { AlertCircle, Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, Edit3, Trash2, Settings, LogOut, Plus, Search, Filter, Download, Mail, CheckCircle, Clock, Target } from 'lucide-react';

// Simulated Privy Hook (replace with actual @privy-io/react-auth in production)
const usePrivy = () => {
  const [user, setUser] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);

  return {
    ready: true,
    authenticated,
    user,
    login: () => {
      setAuthenticated(true);
      setUser({ 
        wallet: { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' },
        email: { address: 'user@example.com' }
      });
    },
    logout: () => {
      setAuthenticated(false);
      setUser(null);
    }
  };
};

// Real-time stats hook (connects to Firebase/API)
const useRealtimeStats = () => {
  const [stats, setStats] = useState({
    totalPlayers: 0,
    totalPrizePools: 0,
    activeLeagues: 0,
    loading: true
  });

  useEffect(() => {
    // Simulated real-time updates - replace with actual Firebase listeners
    const fetchStats = async () => {
      try {
        // In production, this would be:
        // const db = getFirestore();
        // const unsubscribe = onSnapshot(collection(db, 'stats'), (snapshot) => { ... });
        
        // Simulated API call
        const response = await fetch('/api/stats');
        const data = await response.json();
        setStats({
          totalPlayers: data.usersCount || 0,
          totalPrizePools: data.totalPrizePools || 0,
          activeLeagues: data.leaguesCount || 0,
          loading: false
        });
      } catch (error) {
        // Fallback to simulated data
        setStats({
          totalPlayers: 0,
          totalPrizePools: 0,
          activeLeagues: 0,
          loading: false
        });
      }
    };

    fetchStats();
    
    // Set up real-time updates every 5 seconds
    const interval = setInterval(fetchStats, 5000);
    
    return () => clearInterval(interval);
  }, []);

  return stats;
};

// Animated counter component
const AnimatedCounter = ({ value, prefix = '', suffix = '', decimals = 0 }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 1500; // Animation duration in ms
    const steps = 60;
    const increment = value / steps;
    let current = 0;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      current = Math.min(current + increment, value);
      setDisplayValue(current);

      if (step >= steps) {
        setDisplayValue(value);
        clearInterval(timer);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  const formatValue = (val) => {
    if (decimals > 0) {
      return val.toFixed(decimals);
    }
    return Math.floor(val).toLocaleString();
  };

  return (
    <span>
      {prefix}{formatValue(displayValue)}{suffix}
    </span>
  );
};

// Match data structure
const WORLD_CUP_MATCHES = [
  {
    id: 1,
    stage: 'Group A',
    home: 'Mexico',
    away: 'Canada',
    homeFlag: '🇲🇽',
    awayFlag: '🇨🇦',
    date: '2026-06-11',
    time: '14:00',
    venue: 'Mexico City'
  },
  {
    id: 2,
    stage: 'Group A',
    home: 'USA',
    away: 'Morocco',
    homeFlag: '🇺🇸',
    awayFlag: '🇲🇦',
    date: '2026-06-12',
    time: '17:00',
    venue: 'Los Angeles'
  },
  // Add more matches as needed
];

const GoalOracle = () => {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const realtimeStats = useRealtimeStats();
  const [currentView, setCurrentView] = useState('landing');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [userRole, setUserRole] = useState('user'); // 'user', 'admin', 'superadmin'
  const [predictions, setPredictions] = useState({});
  const [leagues, setLeagues] = useState([
    {
      id: 'global',
      name: 'Global League',
      type: 'free',
      members: 15234,
      prize: null,
      admin: 'system',
      pointsSystem: {
        correctResult: 3,
        correctScore: 5,
        penaltyBonus: 2,
        extraTimeBonus: 1
      }
    }
  ]);

  // Landing Page Component
  const LandingPage = () => (
    <div className="landing-page">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-grid"></div>
        <div className="hero-content">
          <div className="hero-badge">
            <Zap size={16} />
            <span>World Cup 2026</span>
          </div>
          <h1 className="hero-title">
            Predict. Compete. <span className="highlight">Dominate.</span>
          </h1>
          <p className="hero-subtitle">
            Join thousands of fans making predictions for FIFA World Cup 2026.
            Play for glory or crypto prizes.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => {
              login();
              setCurrentView('dashboard');
            }}>
              <Globe size={20} />
              Start Predicting
            </button>
            <button className="btn btn-secondary">
              Learn More
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <div className="stat-value">
                {realtimeStats.loading ? (
                  <span className="loading-pulse">...</span>
                ) : (
                  <AnimatedCounter value={realtimeStats.totalPlayers} suffix="+" />
                )}
              </div>
              <div className="stat-label">Players</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {realtimeStats.loading ? (
                  <span className="loading-pulse">...</span>
                ) : (
                  <AnimatedCounter 
                    value={realtimeStats.totalPrizePools} 
                    prefix="$" 
                    decimals={0}
                  />
                )}
              </div>
              <div className="stat-label">Prize Pools</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {realtimeStats.loading ? (
                  <span className="loading-pulse">...</span>
                ) : (
                  <AnimatedCounter value={realtimeStats.activeLeagues} />
                )}
              </div>
              <div className="stat-label">Active Leagues</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <div className="container">
          <div className="section-header">
            <h2>How It Works</h2>
            <p>Three simple steps to start winning</p>
          </div>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <Trophy />
              </div>
              <h3>Make Predictions</h3>
              <p>Predict winners, draws, and outcomes for every World Cup match including knockouts and penalties</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Users />
              </div>
              <h3>Join Leagues</h3>
              <p>Compete globally or create private leagues with friends. Free or crypto-staked competitions</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Award />
              </div>
              <h3>Win Rewards</h3>
              <p>Earn points for correct predictions. Top players win bragging rights or crypto prizes</p>
            </div>
          </div>
        </div>
      </section>

      {/* Crypto Section */}
      <section className="crypto-section">
        <div className="container">
          <div className="crypto-content">
            <div className="crypto-text">
              <h2>Stake. Predict. Win.</h2>
              <p>Create paid leagues with USDC or USDG. Set your own prize distribution. We handle the crypto so you can focus on the game.</p>
              <ul className="crypto-features">
                <li><CheckCircle size={20} /> Secure wallet integration via Privy</li>
                <li><CheckCircle size={20} /> Transparent smart contract payouts</li>
                <li><CheckCircle size={20} /> Customizable prize structures</li>
                <li><CheckCircle size={20} /> Instant settlement after tournament</li>
              </ul>
            </div>
            <div className="crypto-visual">
              <div className="wallet-card">
                <Coins size={48} />
                <div className="wallet-info">
                  <div className="wallet-label">Entry Fee</div>
                  <div className="wallet-amount">50 USDC</div>
                </div>
                <div className="wallet-info">
                  <div className="wallet-label">Prize Pool</div>
                  <div className="wallet-amount">5,000 USDC</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  // Dashboard Component
  const Dashboard = () => (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Your Leagues</h1>
          <p>Manage predictions and track your performance</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCurrentView('create-league')}>
          <Plus size={20} />
          Create League
        </button>
      </div>

      <div className="leagues-grid">
        {leagues.map(league => (
          <div key={league.id} className="league-card" onClick={() => {
            setSelectedLeague(league);
            setCurrentView('league-detail');
          }}>
            <div className="league-header">
              <div className="league-title">
                <Trophy size={24} />
                <h3>{league.name}</h3>
              </div>
              {league.type === 'paid' ? (
                <span className="badge badge-premium">
                  <Coins size={14} />
                  Premium
                </span>
              ) : (
                <span className="badge badge-free">Free</span>
              )}
            </div>
            <div className="league-stats">
              <div className="league-stat">
                <Users size={18} />
                <span>{league.members.toLocaleString()} players</span>
              </div>
              {league.prize && (
                <div className="league-stat">
                  <Trophy size={18} />
                  <span>{league.prize} USDC</span>
                </div>
              )}
            </div>
            <div className="league-footer">
              <span className="league-rank">Your Rank: #42</span>
              <ChevronRight size={18} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Create League Component
  const CreateLeague = () => {
    const [leagueType, setLeagueType] = useState('free');
    const [leagueName, setLeagueName] = useState('');
    const [entryFee, setEntryFee] = useState('');
    const [currency, setCurrency] = useState('USDC');
    const [pointsSystem, setPointsSystem] = useState({
      correctResult: 3,
      correctScore: 5,
      penaltyBonus: 2,
      extraTimeBonus: 1
    });

    return (
      <div className="create-league">
        <div className="page-header">
          <button className="btn-back" onClick={() => setCurrentView('dashboard')}>
            ← Back
          </button>
          <h1>Create Your League</h1>
        </div>

        <div className="create-league-form">
          <div className="form-section">
            <label>League Type</label>
            <div className="type-selector">
              <button 
                className={`type-option ${leagueType === 'free' ? 'active' : ''}`}
                onClick={() => setLeagueType('free')}
              >
                <Unlock size={24} />
                <div>
                  <h4>Free League</h4>
                  <p>Play for fun and glory</p>
                </div>
              </button>
              <button 
                className={`type-option ${leagueType === 'paid' ? 'active' : ''}`}
                onClick={() => setLeagueType('paid')}
              >
                <Lock size={24} />
                <div>
                  <h4>Paid League</h4>
                  <p>Stake crypto, win rewards</p>
                </div>
              </button>
            </div>
          </div>

          <div className="form-section">
            <label>League Name</label>
            <input 
              type="text" 
              placeholder="e.g., Friends & Family 2026"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              className="input-field"
            />
          </div>

          {leagueType === 'paid' && (
            <>
              <div className="form-section">
                <label>Entry Fee</label>
                <div className="input-group">
                  <input 
                    type="number" 
                    placeholder="50"
                    value={entryFee}
                    onChange={(e) => setEntryFee(e.target.value)}
                    className="input-field"
                  />
                  <select 
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="select-field"
                  >
                    <option value="USDC">USDC</option>
                    <option value="USDG">USDG</option>
                  </select>
                </div>
              </div>

              <div className="form-section">
                <label>Prize Distribution</label>
                <div className="prize-distribution">
                  <div className="prize-item">
                    <span>1st Place</span>
                    <input type="number" defaultValue="50" className="input-field-sm" />
                    <span>%</span>
                  </div>
                  <div className="prize-item">
                    <span>2nd Place</span>
                    <input type="number" defaultValue="30" className="input-field-sm" />
                    <span>%</span>
                  </div>
                  <div className="prize-item">
                    <span>3rd Place</span>
                    <input type="number" defaultValue="20" className="input-field-sm" />
                    <span>%</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="form-section">
            <label>Points System</label>
            <div className="points-grid">
              <div className="point-item">
                <label>Correct Result</label>
                <input 
                  type="number" 
                  value={pointsSystem.correctResult}
                  onChange={(e) => setPointsSystem({...pointsSystem, correctResult: parseInt(e.target.value)})}
                  className="input-field-sm"
                />
              </div>
              <div className="point-item">
                <label>Correct Score</label>
                <input 
                  type="number" 
                  value={pointsSystem.correctScore}
                  onChange={(e) => setPointsSystem({...pointsSystem, correctScore: parseInt(e.target.value)})}
                  className="input-field-sm"
                />
              </div>
              <div className="point-item">
                <label>Penalty Bonus</label>
                <input 
                  type="number" 
                  value={pointsSystem.penaltyBonus}
                  onChange={(e) => setPointsSystem({...pointsSystem, penaltyBonus: parseInt(e.target.value)})}
                  className="input-field-sm"
                />
              </div>
              <div className="point-item">
                <label>Extra Time Bonus</label>
                <input 
                  type="number" 
                  value={pointsSystem.extraTimeBonus}
                  onChange={(e) => setPointsSystem({...pointsSystem, extraTimeBonus: parseInt(e.target.value)})}
                  className="input-field-sm"
                />
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setCurrentView('dashboard')}>
              Cancel
            </button>
            <button className="btn btn-primary">
              Create League
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // League Detail Component
  const LeagueDetail = () => {
    const [activeTab, setActiveTab] = useState('predictions');

    return (
      <div className="league-detail">
        <div className="page-header">
          <button className="btn-back" onClick={() => setCurrentView('dashboard')}>
            ← Back to Leagues
          </button>
          <div className="league-info">
            <h1>{selectedLeague?.name}</h1>
            <div className="league-meta">
              <span><Users size={16} /> {selectedLeague?.members.toLocaleString()} players</span>
              {selectedLeague?.type === 'paid' && (
                <span><Coins size={16} /> {selectedLeague?.prize} USDC Pool</span>
              )}
            </div>
          </div>
          {userRole !== 'user' && (
            <button className="btn btn-secondary">
              <Settings size={18} />
              Manage
            </button>
          )}
        </div>

        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'predictions' ? 'active' : ''}`}
            onClick={() => setActiveTab('predictions')}
          >
            Predictions
          </button>
          <button 
            className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            Leaderboard
          </button>
          <button 
            className={`tab ${activeTab === 'rules' ? 'active' : ''}`}
            onClick={() => setActiveTab('rules')}
          >
            Rules
          </button>
        </div>

        {activeTab === 'predictions' && (
          <div className="predictions-view">
            <div className="matches-list">
              {WORLD_CUP_MATCHES.map(match => (
                <PredictionCard key={match.id} match={match} />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="leaderboard">
            <div className="leaderboard-header">
              <h3>Top Players</h3>
              <div className="leaderboard-filters">
                <button className="btn-filter active">Overall</button>
                <button className="btn-filter">This Week</button>
              </div>
            </div>
            <div className="leaderboard-list">
              {[1,2,3,4,5,6,7,8,9,10].map(rank => (
                <div key={rank} className="leaderboard-item">
                  <div className="rank">
                    {rank === 1 && <Trophy size={20} className="gold" />}
                    {rank === 2 && <Trophy size={20} className="silver" />}
                    {rank === 3 && <Trophy size={20} className="bronze" />}
                    {rank > 3 && <span>#{rank}</span>}
                  </div>
                  <div className="player-info">
                    <div className="player-avatar">{String.fromCharCode(65 + rank)}</div>
                    <div className="player-name">Player {rank}</div>
                  </div>
                  <div className="player-stats">
                    <span className="points">{150 - rank * 5} pts</span>
                    <span className="accuracy">{95 - rank}% accuracy</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="rules-view">
            <div className="rules-card">
              <h3>Points System</h3>
              <div className="points-breakdown">
                <div className="point-rule">
                  <Target size={20} />
                  <div>
                    <strong>Correct Result</strong>
                    <p>+{selectedLeague?.pointsSystem.correctResult} points</p>
                  </div>
                </div>
                <div className="point-rule">
                  <Award size={20} />
                  <div>
                    <strong>Correct Score</strong>
                    <p>+{selectedLeague?.pointsSystem.correctScore} points</p>
                  </div>
                </div>
                <div className="point-rule">
                  <Zap size={20} />
                  <div>
                    <strong>Penalty Prediction Bonus</strong>
                    <p>+{selectedLeague?.pointsSystem.penaltyBonus} points</p>
                  </div>
                </div>
                <div className="point-rule">
                  <Clock size={20} />
                  <div>
                    <strong>Extra Time Prediction Bonus</strong>
                    <p>+{selectedLeague?.pointsSystem.extraTimeBonus} point</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Prediction Card Component
  const PredictionCard = ({ match }) => {
    const [prediction, setPrediction] = useState({ result: null, score: { home: '', away: '' }, extraTime: null, penalties: null });

    return (
      <div className="prediction-card">
        <div className="match-header">
          <span className="match-stage">{match.stage}</span>
          <span className="match-date">{new Date(match.date).toLocaleDateString()} • {match.time}</span>
        </div>
        <div className="match-teams">
          <div className="team">
            <span className="flag">{match.homeFlag}</span>
            <span className="team-name">{match.home}</span>
          </div>
          <span className="vs">VS</span>
          <div className="team">
            <span className="team-name">{match.away}</span>
            <span className="flag">{match.awayFlag}</span>
          </div>
        </div>
        <div className="prediction-options">
          <button 
            className={`prediction-btn ${prediction.result === 'home' ? 'active' : ''}`}
            onClick={() => setPrediction({...prediction, result: 'home'})}
          >
            {match.home} Win
          </button>
          <button 
            className={`prediction-btn ${prediction.result === 'draw' ? 'active' : ''}`}
            onClick={() => setPrediction({...prediction, result: 'draw'})}
          >
            Draw
          </button>
          <button 
            className={`prediction-btn ${prediction.result === 'away' ? 'active' : ''}`}
            onClick={() => setPrediction({...prediction, result: 'away'})}
          >
            {match.away} Win
          </button>
        </div>
        <div className="score-prediction">
          <input 
            type="number" 
            min="0" 
            max="10" 
            placeholder="0"
            className="score-input"
            value={prediction.score.home}
            onChange={(e) => setPrediction({...prediction, score: {...prediction.score, home: e.target.value}})}
          />
          <span>-</span>
          <input 
            type="number" 
            min="0" 
            max="10" 
            placeholder="0"
            className="score-input"
            value={prediction.score.away}
            onChange={(e) => setPrediction({...prediction, score: {...prediction.score, away: e.target.value}})}
          />
        </div>
        {match.stage.includes('Round of 16') || match.stage.includes('Quarter') || match.stage.includes('Semi') || match.stage.includes('Final') && (
          <div className="knockout-options">
            <label className="checkbox-label">
              <input type="checkbox" onChange={(e) => setPrediction({...prediction, extraTime: e.target.checked})} />
              <span>Goes to Extra Time</span>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" onChange={(e) => setPrediction({...prediction, penalties: e.target.checked})} />
              <span>Decided by Penalties</span>
            </label>
          </div>
        )}
      </div>
    );
  };

  // Super Admin Dashboard
  const SuperAdminDashboard = () => (
    <div className="admin-dashboard">
      <h1>Super Admin Dashboard</h1>
      <div className="admin-stats">
        <div className="stat-card">
          <Users size={32} />
          <div>
            <div className="stat-value">15,234</div>
            <div className="stat-label">Total Users</div>
          </div>
        </div>
        <div className="stat-card">
          <Trophy size={32} />
          <div>
            <div className="stat-value">156</div>
            <div className="stat-label">Active Leagues</div>
          </div>
        </div>
        <div className="stat-card">
          <Coins size={32} />
          <div>
            <div className="stat-value">$42,450</div>
            <div className="stat-label">Total Prize Pools</div>
          </div>
        </div>
      </div>
      <div className="admin-actions">
        <button className="btn btn-primary">
          <Edit3 size={18} />
          Override Prediction
        </button>
        <button className="btn btn-secondary">
          <Download size={18} />
          Export Data
        </button>
        <button className="btn btn-secondary">
          <Mail size={18} />
          Send Notification
        </button>
      </div>
    </div>
  );

  // Main Navigation
  const Navigation = () => (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-brand" onClick={() => setCurrentView('landing')}>
          <Trophy size={28} />
          <span>GoalOracle</span>
        </div>
        <div className={`nav-menu ${mobileMenuOpen ? 'active' : ''}`}>
          {authenticated && (
            <>
              <a onClick={() => setCurrentView('dashboard')}>Dashboard</a>
              <a onClick={() => setCurrentView('leagues')}>Leagues</a>
              {userRole === 'superadmin' && (
                <a onClick={() => setCurrentView('admin')}>Admin</a>
              )}
            </>
          )}
          {authenticated ? (
            <div className="nav-user">
              <div className="wallet-badge">
                {user?.wallet?.address?.slice(0, 6)}...{user?.wallet?.address?.slice(-4)}
              </div>
              <button className="btn btn-sm" onClick={logout}>
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={login}>
              Connect Wallet
            </button>
          )}
        </div>
        <button className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

        :root {
          --primary: #FF3B30;
          --primary-dark: #E6352A;
          --secondary: #000000;
          --accent: #FFD60A;
          --background: #FAFAFA;
          --surface: #FFFFFF;
          --text: #000000;
          --text-secondary: #666666;
          --border: #E0E0E0;
          --shadow: rgba(0, 0, 0, 0.08);
          --success: #34C759;
          --warning: #FF9500;
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
          background: var(--background);
          color: var(--text);
          line-height: 1.6;
        }

        .app {
          min-height: 100vh;
        }

        /* Navigation */
        .navbar {
          position: sticky;
          top: 0;
          background: var(--surface);
          border-bottom: 2px solid var(--secondary);
          z-index: 1000;
          box-shadow: 0 4px 20px var(--shadow);
        }

        .nav-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 1rem 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .nav-brand {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-family: 'Space Mono', monospace;
          font-weight: 700;
          font-size: 1.5rem;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .nav-brand:hover {
          transform: scale(1.05);
        }

        .nav-brand svg {
          color: var(--primary);
        }

        .nav-menu {
          display: flex;
          align-items: center;
          gap: 2rem;
        }

        .nav-menu a {
          font-weight: 500;
          cursor: pointer;
          transition: color 0.2s;
          position: relative;
        }

        .nav-menu a:hover {
          color: var(--primary);
        }

        .nav-menu a::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 0;
          width: 0;
          height: 2px;
          background: var(--primary);
          transition: width 0.3s;
        }

        .nav-menu a:hover::after {
          width: 100%;
        }

        .nav-user {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .wallet-badge {
          padding: 0.5rem 1rem;
          background: var(--secondary);
          color: white;
          border-radius: 8px;
          font-family: 'Space Mono', monospace;
          font-size: 0.875rem;
        }

        .mobile-toggle {
          display: none;
          background: none;
          border: none;
          cursor: pointer;
        }

        /* Landing Page */
        .landing-page {
          animation: fadeIn 0.6s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .hero {
          position: relative;
          min-height: 90vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: linear-gradient(135deg, #FAFAFA 0%, #F0F0F0 100%);
        }

        .hero-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(var(--border) 1px, transparent 1px),
            linear-gradient(90deg, var(--border) 1px, transparent 1px);
          background-size: 50px 50px;
          opacity: 0.5;
        }

        .hero-content {
          position: relative;
          text-align: center;
          max-width: 900px;
          padding: 2rem;
          animation: slideUp 0.8s ease-out;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1.5rem;
          background: var(--secondary);
          color: white;
          border-radius: 50px;
          font-weight: 600;
          font-size: 0.875rem;
          margin-bottom: 2rem;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        .hero-title {
          font-size: 5rem;
          font-weight: 900;
          line-height: 1.1;
          margin-bottom: 1.5rem;
          font-family: 'Outfit', sans-serif;
          letter-spacing: -0.02em;
        }

        .highlight {
          background: linear-gradient(135deg, var(--primary) 0%, var(--warning) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-subtitle {
          font-size: 1.5rem;
          color: var(--text-secondary);
          margin-bottom: 3rem;
          font-weight: 400;
        }

        .hero-cta {
          display: flex;
          gap: 1rem;
          justify-content: center;
          margin-bottom: 4rem;
        }

        .hero-stats {
          display: flex;
          justify-content: center;
          gap: 4rem;
          padding-top: 3rem;
          border-top: 2px solid var(--border);
        }

        .stat {
          text-align: center;
        }

        .stat-value {
          font-size: 2.5rem;
          font-weight: 800;
          font-family: 'Space Mono', monospace;
          color: var(--primary);
        }

        .stat-label {
          font-size: 1rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .loading-pulse {
          display: inline-block;
          animation: pulse-opacity 1.5s ease-in-out infinite;
        }

        @keyframes pulse-opacity {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }

        /* Buttons */
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 1rem 2rem;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.3s;
          font-family: 'Outfit', sans-serif;
        }

        .btn-primary {
          background: var(--primary);
          color: white;
          box-shadow: 0 4px 20px rgba(255, 59, 48, 0.3);
        }

        .btn-primary:hover {
          background: var(--primary-dark);
          transform: translateY(-2px);
          box-shadow: 0 6px 30px rgba(255, 59, 48, 0.4);
        }

        .btn-secondary {
          background: var(--surface);
          color: var(--text);
          border: 2px solid var(--secondary);
        }

        .btn-secondary:hover {
          background: var(--secondary);
          color: white;
          transform: translateY(-2px);
        }

        .btn-sm {
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
        }

        /* Features Section */
        .features {
          padding: 8rem 2rem;
          background: var(--surface);
        }

        .container {
          max-width: 1400px;
          margin: 0 auto;
        }

        .section-header {
          text-align: center;
          margin-bottom: 4rem;
        }

        .section-header h2 {
          font-size: 3rem;
          font-weight: 800;
          margin-bottom: 1rem;
        }

        .section-header p {
          font-size: 1.25rem;
          color: var(--text-secondary);
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 2rem;
        }

        .feature-card {
          padding: 3rem;
          background: var(--background);
          border: 2px solid var(--secondary);
          border-radius: 16px;
          transition: all 0.3s;
        }

        .feature-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 40px var(--shadow);
        }

        .feature-icon {
          width: 64px;
          height: 64px;
          background: var(--primary);
          color: white;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1.5rem;
        }

        .feature-card h3 {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 1rem;
        }

        .feature-card p {
          color: var(--text-secondary);
          line-height: 1.8;
        }

        /* Crypto Section */
        .crypto-section {
          padding: 8rem 2rem;
          background: var(--secondary);
          color: white;
        }

        .crypto-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4rem;
          align-items: center;
        }

        .crypto-text h2 {
          font-size: 3rem;
          font-weight: 800;
          margin-bottom: 1.5rem;
        }

        .crypto-text p {
          font-size: 1.25rem;
          opacity: 0.8;
          margin-bottom: 2rem;
        }

        .crypto-features {
          list-style: none;
        }

        .crypto-features li {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
          font-size: 1.125rem;
        }

        .crypto-visual {
          display: flex;
          justify-content: center;
        }

        .wallet-card {
          padding: 3rem;
          background: white;
          color: var(--text);
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          transform: rotate(-2deg);
          transition: transform 0.3s;
        }

        .wallet-card:hover {
          transform: rotate(0deg) scale(1.05);
        }

        .wallet-card svg {
          color: var(--primary);
          margin-bottom: 2rem;
        }

        .wallet-info {
          margin-bottom: 1.5rem;
        }

        .wallet-label {
          font-size: 0.875rem;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
        }

        .wallet-amount {
          font-size: 2rem;
          font-weight: 800;
          font-family: 'Space Mono', monospace;
        }

        /* Dashboard */
        .dashboard {
          max-width: 1400px;
          margin: 0 auto;
          padding: 4rem 2rem;
        }

        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 3rem;
        }

        .dashboard-header h1 {
          font-size: 3rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
        }

        .dashboard-header p {
          color: var(--text-secondary);
          font-size: 1.125rem;
        }

        .leagues-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 2rem;
        }

        .league-card {
          padding: 2rem;
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 16px;
          cursor: pointer;
          transition: all 0.3s;
        }

        .league-card:hover {
          border-color: var(--primary);
          transform: translateY(-4px);
          box-shadow: 0 12px 40px var(--shadow);
        }

        .league-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.5rem;
        }

        .league-title {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .league-title svg {
          color: var(--primary);
        }

        .league-title h3 {
          font-size: 1.5rem;
          font-weight: 700;
        }

        .badge {
          padding: 0.25rem 0.75rem;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
        }

        .badge-premium {
          background: var(--accent);
          color: var(--secondary);
        }

        .badge-free {
          background: var(--background);
          color: var(--text-secondary);
          border: 1px solid var(--border);
        }

        .league-stats {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        .league-stat {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-secondary);
        }

        .league-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }

        .league-rank {
          font-weight: 600;
          color: var(--primary);
        }

        /* Create League */
        .create-league {
          max-width: 900px;
          margin: 0 auto;
          padding: 4rem 2rem;
        }

        .page-header {
          margin-bottom: 3rem;
        }

        .btn-back {
          background: none;
          border: none;
          font-size: 1rem;
          color: var(--text-secondary);
          cursor: pointer;
          margin-bottom: 1rem;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: color 0.2s;
        }

        .btn-back:hover {
          color: var(--primary);
        }

        .page-header h1 {
          font-size: 2.5rem;
          font-weight: 800;
        }

        .create-league-form {
          background: var(--surface);
          border: 2px solid var(--secondary);
          border-radius: 16px;
          padding: 3rem;
        }

        .form-section {
          margin-bottom: 2rem;
        }

        .form-section label {
          display: block;
          font-weight: 600;
          margin-bottom: 1rem;
          font-size: 1.125rem;
        }

        .type-selector {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .type-option {
          padding: 2rem;
          border: 2px solid var(--border);
          border-radius: 12px;
          background: var(--background);
          cursor: pointer;
          transition: all 0.3s;
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          text-align: left;
        }

        .type-option:hover {
          border-color: var(--primary);
        }

        .type-option.active {
          border-color: var(--primary);
          background: rgba(255, 59, 48, 0.05);
        }

        .type-option svg {
          flex-shrink: 0;
          margin-top: 0.25rem;
        }

        .type-option h4 {
          font-size: 1.125rem;
          margin-bottom: 0.5rem;
        }

        .type-option p {
          color: var(--text-secondary);
          font-size: 0.875rem;
        }

        .input-field {
          width: 100%;
          padding: 1rem;
          border: 2px solid var(--border);
          border-radius: 8px;
          font-size: 1rem;
          font-family: 'Outfit', sans-serif;
          transition: border-color 0.3s;
        }

        .input-field:focus {
          outline: none;
          border-color: var(--primary);
        }

        .input-group {
          display: flex;
          gap: 1rem;
        }

        .select-field {
          padding: 1rem;
          border: 2px solid var(--border);
          border-radius: 8px;
          font-size: 1rem;
          font-family: 'Outfit', sans-serif;
          background: var(--surface);
          cursor: pointer;
        }

        .prize-distribution {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .prize-item {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .prize-item span:first-child {
          flex: 1;
          font-weight: 500;
        }

        .input-field-sm {
          width: 80px;
          padding: 0.5rem;
          border: 2px solid var(--border);
          border-radius: 8px;
          font-size: 1rem;
          text-align: center;
        }

        .points-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.5rem;
        }

        .point-item label {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
        }

        .form-actions {
          display: flex;
          gap: 1rem;
          justify-content: flex-end;
          margin-top: 3rem;
          padding-top: 2rem;
          border-top: 1px solid var(--border);
        }

        /* League Detail */
        .league-detail {
          max-width: 1400px;
          margin: 0 auto;
          padding: 4rem 2rem;
        }

        .league-info h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin-bottom: 1rem;
        }

        .league-meta {
          display: flex;
          gap: 2rem;
          color: var(--text-secondary);
        }

        .league-meta span {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .tabs {
          display: flex;
          gap: 0;
          margin: 3rem 0 2rem 0;
          border-bottom: 2px solid var(--border);
        }

        .tab {
          padding: 1rem 2rem;
          background: none;
          border: none;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          color: var(--text-secondary);
          border-bottom: 3px solid transparent;
          transition: all 0.3s;
        }

        .tab.active {
          color: var(--primary);
          border-bottom-color: var(--primary);
        }

        .tab:hover {
          color: var(--text);
        }

        /* Prediction Card */
        .matches-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .prediction-card {
          padding: 2rem;
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 16px;
          transition: all 0.3s;
        }

        .prediction-card:hover {
          box-shadow: 0 8px 30px var(--shadow);
        }

        .match-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 1.5rem;
          font-size: 0.875rem;
        }

        .match-stage {
          font-weight: 600;
          color: var(--primary);
        }

        .match-date {
          color: var(--text-secondary);
        }

        .match-teams {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3rem;
          margin-bottom: 2rem;
        }

        .team {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }

        .flag {
          font-size: 3rem;
        }

        .team-name {
          font-weight: 700;
          font-size: 1.125rem;
        }

        .vs {
          font-weight: 800;
          color: var(--text-secondary);
          font-size: 0.875rem;
        }

        .prediction-options {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .prediction-btn {
          padding: 1rem;
          border: 2px solid var(--border);
          border-radius: 8px;
          background: var(--background);
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s;
          font-family: 'Outfit', sans-serif;
        }

        .prediction-btn:hover {
          border-color: var(--primary);
        }

        .prediction-btn.active {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }

        .score-prediction {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .score-input {
          width: 60px;
          height: 60px;
          border: 2px solid var(--border);
          border-radius: 8px;
          font-size: 1.5rem;
          font-weight: 700;
          text-align: center;
          font-family: 'Space Mono', monospace;
        }

        .knockout-options {
          display: flex;
          gap: 2rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
        }

        .checkbox-label input[type="checkbox"] {
          width: 20px;
          height: 20px;
          cursor: pointer;
        }

        /* Leaderboard */
        .leaderboard {
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 16px;
          padding: 2rem;
        }

        .leaderboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--border);
        }

        .leaderboard-filters {
          display: flex;
          gap: 0.5rem;
        }

        .btn-filter {
          padding: 0.5rem 1rem;
          border: 2px solid var(--border);
          border-radius: 8px;
          background: var(--background);
          cursor: pointer;
          font-weight: 600;
          font-size: 0.875rem;
          transition: all 0.3s;
        }

        .btn-filter.active {
          background: var(--secondary);
          color: white;
          border-color: var(--secondary);
        }

        .leaderboard-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .leaderboard-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--background);
          border-radius: 12px;
          transition: all 0.3s;
        }

        .leaderboard-item:hover {
          background: rgba(255, 59, 48, 0.05);
        }

        .rank {
          width: 40px;
          text-align: center;
          font-weight: 700;
          font-family: 'Space Mono', monospace;
        }

        .gold { color: #FFD700; }
        .silver { color: #C0C0C0; }
        .bronze { color: #CD7F32; }

        .player-info {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .player-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--primary);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 1.25rem;
        }

        .player-name {
          font-weight: 600;
        }

        .player-stats {
          display: flex;
          gap: 2rem;
          align-items: center;
        }

        .points {
          font-weight: 700;
          font-family: 'Space Mono', monospace;
          font-size: 1.125rem;
        }

        .accuracy {
          color: var(--text-secondary);
          font-size: 0.875rem;
        }

        /* Rules View */
        .rules-view {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .rules-card {
          padding: 2rem;
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 16px;
        }

        .rules-card h3 {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
        }

        .points-breakdown {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .point-rule {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.5rem;
          background: var(--background);
          border-radius: 12px;
        }

        .point-rule svg {
          color: var(--primary);
          flex-shrink: 0;
        }

        .point-rule strong {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 1.125rem;
        }

        .point-rule p {
          color: var(--text-secondary);
        }

        /* Admin Dashboard */
        .admin-dashboard {
          max-width: 1400px;
          margin: 0 auto;
          padding: 4rem 2rem;
        }

        .admin-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 2rem;
          margin-bottom: 3rem;
        }

        .stat-card {
          padding: 2rem;
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 16px;
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .stat-card svg {
          color: var(--primary);
        }

        .admin-actions {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .hero-title {
            font-size: 3rem;
          }

          .hero-subtitle {
            font-size: 1.125rem;
          }

          .hero-cta {
            flex-direction: column;
          }

          .hero-stats {
            flex-direction: column;
            gap: 2rem;
          }

          .crypto-content {
            grid-template-columns: 1fr;
          }

          .features-grid {
            grid-template-columns: 1fr;
          }

          .nav-menu {
            position: fixed;
            top: 70px;
            left: 0;
            right: 0;
            background: var(--surface);
            flex-direction: column;
            padding: 2rem;
            border-top: 2px solid var(--secondary);
            transform: translateY(-100%);
            transition: transform 0.3s;
          }

          .nav-menu.active {
            transform: translateY(0);
          }

          .mobile-toggle {
            display: block;
          }

          .prediction-options {
            grid-template-columns: 1fr;
          }

          .type-selector {
            grid-template-columns: 1fr;
          }

          .points-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <Navigation />
      
      {currentView === 'landing' && <LandingPage />}
      {currentView === 'dashboard' && <Dashboard />}
      {currentView === 'create-league' && <CreateLeague />}
      {currentView === 'league-detail' && <LeagueDetail />}
      {currentView === 'admin' && userRole === 'superadmin' && <SuperAdminDashboard />}
    </div>
  );
};

export default GoalOracle;