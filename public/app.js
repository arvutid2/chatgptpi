const state = {
  user: null,
  view: 'dashboard',
  activeNav: 'dashboard',
  theme: 'dark',
  lobbies: [],
  games: [],
  currentGameId: null,
  currentGame: null,
  friends: [],
  friendSuggestions: [],
  tournaments: [],
  chatMessages: [],
  chatInput: '',
  chatStickToBottom: true,
  chatShouldScrollToBottom: false,
  chatInputFocused: false,
  chatCaret: null,
  profile: null,
  pollHandle: null,
  gamePollHandle: null,
  friendQuery: '',
  friendDraft: '',
  friendSearchFocused: false,
  friendSearchCaret: null,
};

const THEME_KEY = 'astra-games-theme';
const DASHBOARD_INTERVAL = 4000;
const GAME_INTERVAL = 2500;

const appEl = document.getElementById('app');
const navEl = document.querySelector('.sidebar__nav');
const themeToggle = document.getElementById('theme-toggle');
const toastEl = document.getElementById('toast');
const userBadge = document.getElementById('user-badge');

if (!appEl) {
  throw new Error('App container not found');
}

init();

function init() {
  state.theme = loadThemePreference();
  applyTheme(state.theme);
  updateThemeToggle();
  attachListeners();
  refreshSession().finally(() => {
    if (state.user) {
      startPolling();
    }
    render();
  });
}

function attachListeners() {
  if (navEl) {
    navEl.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-view]');
      if (!button || button.disabled) return;
      const view = button.getAttribute('data-view');
      if (view === 'logout') {
        logout();
        return;
      }
      setView(view);
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else if (state.user) {
      startPolling();
      if (state.currentGameId) {
        startGamePolling(state.currentGameId);
      }
    }
  });

  appEl.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === 'login-form') {
      event.preventDefault();
      await handleLogin(form);
    } else if (form.id === 'create-lobby-form') {
      event.preventDefault();
      await handleCreateLobby(form);
    } else if (form.id === 'ai-lobby-form') {
      event.preventDefault();
      await handleCreateAiMatch(form);
    } else if (form.id === 'chat-form') {
      event.preventDefault();
      await handleChatSubmit(form);
    } else if (form.id === 'add-friend-form') {
      event.preventDefault();
      await handleAddFriend(form);
    }
  });

  appEl.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const view = target.getAttribute('data-view');
    if (view) {
      setView(view);
      return;
    }
    const action = target.getAttribute('data-action');
    if (action === 'join-lobby') {
      const lobbyId = target.getAttribute('data-lobby');
      if (lobbyId) {
        await joinLobby(lobbyId);
      }
    }
    if (action === 'cancel-lobby') {
      const lobbyId = target.getAttribute('data-lobby');
      if (lobbyId) {
        await cancelLobby(lobbyId);
      }
    }
    if (action === 'open-game') {
      const gameId = target.getAttribute('data-game');
      if (gameId) {
        await openGame(gameId);
      }
    }
    if (action === 'submit-move') {
      const move = target.getAttribute('data-move');
      if (move && state.currentGameId) {
        await submitMove(state.currentGameId, move);
      }
    }
    if (action === 'join-tournament') {
      const id = target.getAttribute('data-tournament');
      if (id) {
        await joinTournament(id);
      }
    }
    if (action === 'open-profile') {
      const username = target.getAttribute('data-username');
      const origin = target.getAttribute('data-origin');
      if (username) {
        setView('profile', { activeNav: origin || state.activeNav, skipProfileLoad: true });
        await loadProfile(username);
      }
    }
    if (action === 'remove-friend') {
      const username = target.getAttribute('data-username');
      if (username) {
        await removeFriend(username);
      }
    }
  });

  appEl.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains('chat-log')) return;
      const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
      state.chatStickToBottom = nearBottom;
    },
    true
  );

  appEl.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'friend-name' && target instanceof HTMLInputElement) {
      state.friendDraft = target.value;
      return;
    }
    if (target.id === 'friend-search' && target instanceof HTMLInputElement) {
      const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      state.friendQuery = target.value;
      state.friendSearchCaret = caret;
      state.friendSearchFocused = true;
      if (state.view === 'friends') {
        renderFriendsView();
      }
      return;
    }
    if (target.closest('#chat-form') && target instanceof HTMLInputElement && target.name === 'message') {
      const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      state.chatInput = target.value;
      state.chatCaret = caret;
      state.chatInputFocused = true;
    }
  });

  appEl.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'friend-search' && target instanceof HTMLInputElement) {
      state.friendSearchFocused = true;
      const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      state.friendSearchCaret = caret;
    }
    if (target.closest('#chat-form') && target instanceof HTMLInputElement && target.name === 'message') {
      state.chatInputFocused = true;
      const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      state.chatCaret = caret;
    }
  });

  appEl.addEventListener('focusout', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'friend-search' && target instanceof HTMLInputElement) {
      const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      state.friendSearchCaret = caret;
      state.friendSearchFocused = false;
    }
    if (target.closest('#chat-form') && target instanceof HTMLInputElement && target.name === 'message') {
      const caret = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      state.chatCaret = caret;
      state.chatInputFocused = false;
    }
  });
}

function loadThemePreference() {
  const value = localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

function setTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, state.theme);
  applyTheme(state.theme);
  updateThemeToggle();
}

function updateThemeToggle() {
  if (!themeToggle) return;
  const icon = themeToggle.querySelector('.theme-toggle__icon');
  const label = themeToggle.querySelector('.theme-toggle__label');
  if (state.theme === 'light') {
    if (icon) icon.textContent = '☀️';
    if (label) label.textContent = 'Light';
  } else {
    if (icon) icon.textContent = '🌙';
    if (label) label.textContent = 'Dark';
  }
}

async function refreshSession() {
  try {
    const { user } = await api('/api/auth/session');
    state.user = user;
    updateNavVisibility();
    updateUserBadge();
  } catch (error) {
    console.error('Failed to fetch session', error);
    state.user = null;
  }
}

function startPolling() {
  stopPolling();
  refreshDashboard();
  state.pollHandle = setInterval(refreshDashboard, DASHBOARD_INTERVAL);
}

function stopPolling() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
}

async function refreshDashboard() {
  if (!state.user) return;
  try {
    const previousMessages = state.chatMessages || [];
    const previousLastId = previousMessages.length ? previousMessages[previousMessages.length - 1].id : null;
    const [sessionRes, lobbiesRes, gamesRes, friendsRes, tournamentsRes, chatRes] = await Promise.all([
      api('/api/auth/session'),
      api('/api/lobbies'),
      api('/api/games'),
      api('/api/friends'),
      api('/api/tournaments'),
      api('/api/chat'),
    ]);
    state.user = sessionRes.user;
    state.lobbies = lobbiesRes.lobbies || [];
    state.games = gamesRes.games || [];
    state.friends = friendsRes.friends || [];
    state.friendSuggestions = friendsRes.suggestions || [];
    state.tournaments = tournamentsRes.tournaments || [];
    state.chatMessages = chatRes.messages || [];
    const latestMessages = state.chatMessages;
    const latestLastId = latestMessages.length ? latestMessages[latestMessages.length - 1].id : null;
    if (latestLastId && latestLastId !== previousLastId && state.chatStickToBottom) {
      state.chatShouldScrollToBottom = true;
    }
    updateNavVisibility();
    updateUserBadge();
    if (state.view !== 'game') {
      render();
    } else if (state.currentGameId) {
      await openGame(state.currentGameId, { preserveView: true });
    }
  } catch (error) {
    console.error('Dashboard refresh failed', error);
    if (error.status === 401) {
      stopPolling();
      resetState();
      render();
    }
  }
}

function resetState() {
  state.user = null;
  state.view = 'dashboard';
  state.activeNav = 'dashboard';
  state.lobbies = [];
  state.games = [];
  state.currentGameId = null;
  state.currentGame = null;
  state.friends = [];
  state.friendSuggestions = [];
  state.tournaments = [];
  state.chatMessages = [];
  state.chatInput = '';
  state.chatStickToBottom = true;
  state.chatShouldScrollToBottom = false;
  state.chatInputFocused = false;
  state.chatCaret = null;
  state.profile = null;
  state.friendQuery = '';
  state.friendDraft = '';
  state.friendSearchFocused = false;
  state.friendSearchCaret = null;
  stopPolling();
  stopGamePolling();
  updateNavVisibility();
  updateUserBadge();
}

function setView(view, options = {}) {
  if (!state.user && view !== 'dashboard') return;
  if (view !== 'game') {
    stopGamePolling();
    state.currentGameId = null;
    state.currentGame = null;
  }
  const { activeNav, skipProfileLoad = false } = options;
  if (view !== 'chat') {
    state.chatInputFocused = false;
    state.chatCaret = null;
  }
  if (view !== 'friends') {
    state.friendSearchFocused = false;
    state.friendSearchCaret = null;
  }
  state.view = view;
  state.activeNav = activeNav || view;
  if (view !== 'profile') {
    state.profile = null;
  }
  switch (view) {
    case 'dashboard':
    case 'lobbies':
    case 'friends':
    case 'tournaments':
    case 'chat':
      render();
      break;
    case 'profile':
      if (state.user && !skipProfileLoad) {
        loadProfile(state.user.username);
      }
      render();
      break;
    default:
      state.view = 'dashboard';
      state.activeNav = 'dashboard';
      render();
  }
}

function render() {
  updateThemeToggle();
  updateNavActive();
  updateUserBadge();
  if (!state.user) {
    renderLogin();
    return;
  }
  switch (state.view) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'lobbies':
      renderLobbyView();
      break;
    case 'friends':
      renderFriendsView();
      break;
    case 'tournaments':
      renderTournamentsView();
      break;
    case 'chat':
      renderChatView();
      break;
    case 'profile':
      renderProfileView();
      break;
    case 'game':
      renderGameView();
      break;
    default:
      renderDashboard();
  }
}

function renderLogin() {
  appEl.innerHTML = `
      <section class="card card--gradient" aria-labelledby="login-title">
        <h2 id="login-title">Sign in to Astra Games</h2>
        <p class="subtitle">Pick a mock username to receive a 1,000 π practice balance and explore the duel lobby.</p>
        <form id="login-form" class="login-form">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" minlength="3" maxlength="24" required placeholder="e.g. cosmic-flipper" />
          <button type="submit" class="btn btn-primary">Enter the arena</button>
        </form>
      </section>
  `;
}

async function handleLogin(form) {
  const username = form.username.value.trim();
  if (!username) return;
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: { username },
    });
    state.user = user;
    updateNavVisibility();
    updateUserBadge();
    state.view = 'dashboard';
    showToast(`Welcome back, ${user.username}!`);
    startPolling();
    render();
  } catch (error) {
    showToast(error.message || 'Login failed', true);
  }
}

function renderDashboard() {
  if (!state.user) return;
  const stats = state.user.stats || { wins: 0, losses: 0, netEarnings: 0 };
  const activeGames = state.games.filter((game) => game.status === 'in_progress');
  const recentGames = state.games.filter((game) => game.status !== 'in_progress').slice(0, 4);
  const openLobbies = state.lobbies.slice(0, 4);
  const tournamentsPreview = state.tournaments.slice(0, 2);
  const highlightLobby = openLobbies[0] || null;
  const highlightTournament = state.tournaments.reduce((best, entry) => {
    if (!entry) return best;
    if (!best) return entry;
    const entryPot = entry.currentPot || 0;
    const bestPot = best.currentPot || 0;
    return entryPot > bestPot ? entry : best;
  }, null);
  const highlightLeader =
    highlightTournament && Array.isArray(highlightTournament.leaderboard) && highlightTournament.leaderboard.length > 0
      ? highlightTournament.leaderboard[0]
      : null;
  const featureCards = [
    {
      key: 'escrow',
      title: 'Programmable escrow pots',
      copy:
        'Buy-ins lock automatically and the champion receives 90% instantly while Astra keeps the 10% house fee.',
      art: svgDataUri(`
        <svg width="260" height="160" viewBox="0 0 260 160" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="escrow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#FFB237" />
              <stop offset="100%" stop-color="#F37EC7" />
            </linearGradient>
          </defs>
          <rect width="260" height="160" rx="28" fill="#1A1238" />
          <circle cx="74" cy="86" r="44" fill="url(#escrow-gradient)" opacity="0.86" />
          <circle cx="170" cy="60" r="26" fill="#3AD0B7" opacity="0.45" />
          <path d="M48 124 Q130 78 212 126" stroke="#FFE6A7" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.65" />
          <path d="M70 52 L120 28 L154 52" fill="#FFB237" opacity="0.45" />
        </svg>
      `),
      className: 'gallery-card--escrow',
    },
    {
      key: 'ai',
      title: 'Astra AI sparring',
      copy: 'Persistent RPS vs AI lets you rehearse AFK timers, escrow, and stat tracking before challenging friends.',
      art: svgDataUri(`
        <svg width="260" height="160" viewBox="0 0 260 160" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ai-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#1FC7D4" />
              <stop offset="100%" stop-color="#906AFF" />
            </linearGradient>
          </defs>
          <rect width="260" height="160" rx="28" fill="#101A3F" />
          <circle cx="90" cy="70" r="32" fill="url(#ai-gradient)" opacity="0.9" />
          <circle cx="186" cy="92" r="40" fill="#FFB237" opacity="0.35" />
          <path d="M40 118 C90 84 170 84 220 118" stroke="#43E7C4" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.7" />
          <rect x="118" y="46" width="68" height="36" rx="12" fill="#1A1238" opacity="0.85" />
          <circle cx="136" cy="64" r="6" fill="#FFB237" />
          <circle cx="168" cy="64" r="6" fill="#3AD0B7" />
        </svg>
      `),
      className: 'gallery-card--ai',
    },
    {
      key: 'tournaments',
      title: 'Live re-entry tournaments',
      copy: 'Every listed event is already live. Re-enter as often as you like and climb to the top-three payout.',
      art: svgDataUri(`
        <svg width="260" height="160" viewBox="0 0 260 160" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="tourney-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#3AD0B7" />
              <stop offset="100%" stop-color="#FFE066" />
            </linearGradient>
          </defs>
          <rect width="260" height="160" rx="28" fill="#161032" />
          <path d="M60 120 L90 48 L124 120 Z" fill="url(#tourney-gradient)" opacity="0.8" />
          <path d="M128 120 L162 36 L198 120 Z" fill="#FFB237" opacity="0.4" />
          <circle cx="162" cy="44" r="18" fill="#1FC7D4" opacity="0.8" />
          <circle cx="92" cy="44" r="14" fill="#F37EC7" opacity="0.6" />
          <path d="M48 130 H212" stroke="#FFE6A7" stroke-width="4" stroke-linecap="round" opacity="0.55" />
        </svg>
      `),
      className: 'gallery-card--tournaments',
    },
  ];

  appEl.innerHTML = `
    <section class="card card--hero">
      <div class="hero hero--astra">
        <div class="hero__content">
          <p class="hero__eyebrow">Welcome to Astra Games</p>
          <h2>Spin up cosmic 1v1 duels in seconds</h2>
          <p class="subtitle">Mock Pi escrow, instant payouts, and PancakeSwap-inspired polish while we prepare wallet integration.</p>
          <div class="hero__actions">
            <button class="btn btn-primary" data-view="lobbies">Create a lobby</button>
            <button class="btn btn-secondary" data-view="tournaments">Browse tournaments</button>
          </div>
          <dl class="hero__metrics">
            <div class="hero__metric">
              <dt>Mock bankroll</dt>
              <dd>${formatPi(state.user.balance)}</dd>
            </div>
            <div class="hero__metric">
              <dt>Record</dt>
              <dd>${stats.wins || 0}W · ${stats.losses || 0}L</dd>
            </div>
            <div class="hero__metric">
              <dt>Net earnings</dt>
              <dd>${formatPi(stats.netEarnings || 0, true)}</dd>
            </div>
          </dl>
        </div>
        <div class="hero__visual" aria-hidden="true">
          <div class="hero-orbit">
            <div class="hero-orbit__gradient"></div>
            <div class="hero-orbit__ring hero-orbit__ring--outer"></div>
            <div class="hero-orbit__ring hero-orbit__ring--inner"></div>
            <div class="hero-orbit__planet"></div>
            <div class="hero-orbit__card hero-orbit__card--lobby">
              <span>${highlightLobby ? 'Featured lobby' : 'Waiting for host'}</span>
              <strong>${highlightLobby ? escapeHtml(highlightLobby.host.username) : 'Launch one'}</strong>
              <small>${
                highlightLobby
                  ? `${escapeHtml(highlightLobby.gameLabel || 'RPS PvP')} · ${formatPi(highlightLobby.stake)}`
                  : 'Escrow opens instantly'
              }</small>
            </div>
            <div class="hero-orbit__card hero-orbit__card--pot">
              <span>Biggest live pot</span>
              <strong>${highlightTournament ? formatPi(highlightTournament.currentPot || 0) : formatPi(0)}</strong>
              <small>${
                highlightLeader
                  ? `${escapeHtml(highlightLeader.username)} leading`
                  : 'Top spot available'
              }</small>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="section-title">
        <h3>Performance snapshot</h3>
        <span>Escrow-secured Pi battles</span>
      </div>
      <div class="grid grid--three">
        ${renderStat('Balance', formatPi(state.user.balance))}
        ${renderStat('Wins', stats.wins || 0)}
        ${renderStat('Losses', stats.losses || 0)}
        ${renderStat('Net earnings', formatPi(stats.netEarnings || 0, true))}
        ${renderStat('Active matches', activeGames.length)}
        ${renderStat('Friends', state.user.friendCount || state.friends.length || 0)}
      </div>
    </section>

    <section class="card card--gallery">
      <div class="section-title">
        <h3>Why the community loves Astra Games</h3>
        <span>PancakeSwap-inspired visuals with DALL·E-flavored artwork</span>
      </div>
      <div class="gallery-grid">
        ${
          featureCards
            .map(
              (feature) => `
                <article class="gallery-card ${feature.className}">
                  <figure class="gallery-card__art">
                    <img src="${feature.art}" alt="" loading="lazy" />
                  </figure>
                  <div class="gallery-card__body">
                    <h4>${feature.title}</h4>
                    <p>${feature.copy}</p>
                  </div>
                </article>
              `
            )
            .join('')
        }
      </div>
    </section>

    <section class="card">
      <div class="section-title">
        <h3>Live lobbies</h3>
        <button class="btn btn-ghost" data-view="lobbies">View all</button>
      </div>
      <div class="lobby-list">
        ${
          openLobbies.length === 0
            ? '<div class="empty-state">No public lobbies right now. Create one and invite a challenger!</div>'
            : openLobbies
                .map((lobby) => {
                  const isYours = lobby.isYours;
                  return `
                    <article class="lobby-card">
                      <div class="lobby-card__meta">
                        <strong>${escapeHtml(lobby.host.username)}</strong>
                        <span class="badge">${escapeHtml(lobby.gameLabel || 'RPS PvP')}</span>
                        <span class="badge">Buy-in ${formatPi(lobby.stake)}</span>
                      </div>
                      ${
                        isYours
                          ? `<button class="btn btn-ghost" data-action="cancel-lobby" data-lobby="${lobby.id}">Close lobby</button>`
                          : `<button class="btn btn-primary" data-action="join-lobby" data-lobby="${lobby.id}">Join</button>`
                      }
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>

    <section class="card">
      <div class="section-title">
        <h3>Recent matches</h3>
        <span>Visit your profile for full history</span>
      </div>
      <div class="grid">
        ${
          recentGames.length === 0
            ? '<div class="empty-state">You have not completed any matches yet.</div>'
            : recentGames.map((game) => renderGameSummary(game, { allowOpen: false })).join('')
        }
      </div>
    </section>

    <section class="card card--secondary">
      <div class="section-title">
        <h3>Live tournaments</h3>
        <span>Re-enter anytime · Top 3 split 90% of the pot</span>
      </div>
      <div class="tournament-peek">
        ${
          tournamentsPreview.length === 0
            ? '<div class="empty-state">Tournaments are loading...</div>'
            : tournamentsPreview
                .map((tournament) => {
                  const leaders = tournament.leaderboard || [];
                  const statusText = tournamentStatusLabel(tournament.status);
                  return `
                    <article class="tournament-card">
                      <header class="tournament-card__header">
                        <div>
                          <strong>${escapeHtml(tournament.title)}</strong>
                          <span class="badge">${escapeHtml(tournament.style)}</span>
                        </div>
                        <span class="badge badge--accent">${formatPi(tournament.entryFee)} buy-in</span>
                      </header>
                      <p class="subtitle">${escapeHtml(tournament.location)} · ${scheduleLabel}</p>
                      <p class="subtitle">Status ${statusText} · Pot ${formatPi(tournament.currentPot || 0)}</p>
                      <p class="subtitle">Entries ${tournament.totalEntries} · Your runs ${tournament.userEntries || 0}</p>
                      <ol class="leaderboard leaderboard--compact" aria-label="Top five standings">
                        ${
                          leaders.length === 0
                            ? '<li class="empty-state">Standings appear once games conclude.</li>'
                            : leaders
                                .slice(0, 5)
                                .map(
                                  (entry) => `
                                    <li class="leaderboard__item">
                                      <span>${entry.rank}. ${escapeHtml(entry.username)}</span>
                                      <span>${entry.score} pts · ${entry.entries}x</span>
                                    </li>
                                  `
                                )
                                .join('')
                        }
                      </ol>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;
}

function renderLobbyView() {
  if (!state.user) return;
  const hasLobby = state.lobbies.some((lobby) => lobby.isYours);
  const gameOptions = [
    { value: 'rps_pvp', label: 'Rock · Paper · Scissors (PvP)', disabled: false },
    { value: 'pi_trivia', label: 'Pi Trivia (coming soon)', disabled: true },
    { value: 'dex_speedrun', label: 'DEX Speedrun (coming soon)', disabled: true },
  ];
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Create a lobby</h3>
        <span>Pick a game and buy-in — escrow keeps the pot safe until the duel settles</span>
      </div>
      <form id="create-lobby-form" class="form-grid">
        <div class="form-field">
          <label for="lobby-game">Game</label>
          <select id="lobby-game" name="gameType" ${hasLobby ? 'disabled' : ''}>
            ${
              gameOptions
                .map(
                  (option) => `
                    <option value="${option.value}" ${option.disabled ? 'disabled' : ''} ${
                    option.value === 'rps_pvp' ? 'selected' : ''
                  }>${option.label}</option>
                  `
                )
                .join('')
            }
          </select>
        </div>
        <div class="form-field">
          <label for="stake">Buy-in π</label>
          <input type="number" id="stake" name="stake" min="1" max="${Math.max(state.user.balance, 1)}" step="1" required ${
            hasLobby ? 'disabled' : ''
          } />
        </div>
        <div class="form-field form-field--actions">
          <button type="submit" class="btn btn-primary" ${hasLobby ? 'disabled' : ''}>Launch lobby</button>
        </div>
      </form>
      ${
        hasLobby
          ? '<p class="subtitle">You already have a live lobby. Close it below to open another.</p>'
          : '<p class="subtitle">Players can join instantly — both buy-ins lock into escrow before round one.</p>'
      }
    </section>
    <section class="card card--ai">
      <div class="section-title">
        <h3>Persistent RPS vs Astra AI</h3>
        <span>Perfect for testing escrow flow, AFK timeouts, and stats without waiting for other players</span>
      </div>
      <form id="ai-lobby-form" class="form-grid">
        <div class="form-field">
          <label for="ai-stake">Buy-in π</label>
          <input type="number" id="ai-stake" name="stake" min="1" max="${Math.max(state.user.balance, 1)}" step="1" required />
        </div>
        <div class="form-field form-field--actions">
          <button type="submit" class="btn btn-secondary">Start AI duel</button>
        </div>
      </form>
      <p class="subtitle">Astra AI adapts to your move history, so you can rehearse strategies before sending live invites.</p>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Live lobbies</h3>
        <span>${state.lobbies.length} open</span>
      </div>
      <div class="lobby-list">
        ${
          state.lobbies.length === 0
            ? '<div class="empty-state">No lobbies yet. Be the first to spin one up!</div>'
            : state.lobbies
                .map((lobby) => {
                  const isYours = lobby.isYours;
                  return `
                    <article class="lobby-card">
                      <div class="lobby-card__meta">
                        <strong>${escapeHtml(lobby.host.username)}</strong>
                        <span class="badge">${escapeHtml(lobby.gameLabel || 'RPS PvP')}</span>
                        <span class="badge">Buy-in ${formatPi(lobby.stake)}</span>
                        <span class="badge">Created ${timeAgo(lobby.createdAt)}</span>
                      </div>
                      ${
                        isYours
                          ? `<button class="btn btn-ghost" data-action="cancel-lobby" data-lobby="${lobby.id}">Close lobby</button>`
                          : `<button class="btn btn-primary" data-action="join-lobby" data-lobby="${lobby.id}">Join</button>`
                      }
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;
}

function renderFriendsView() {
  const friends = state.friends || [];
  const suggestions = state.friendSuggestions || [];
  const query = (state.friendQuery || '').trim().toLowerCase();
  const filteredFriends = query
    ? friends.filter((friend) => friend.username.toLowerCase().includes(query))
    : friends;
  const friendDraft = state.friendDraft || '';
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Friends</h3>
        <span>${friends.length} contact${friends.length === 1 ? '' : 's'}</span>
      </div>
      <div class="friend-toolbar">
        <label class="visually-hidden" for="friend-search">Search friends</label>
        <input
          type="search"
          id="friend-search"
          name="friend-search"
          placeholder="Search friends"
          autocomplete="off"
          value="${escapeHtml(state.friendQuery)}"
        />
      </div>
      <div class="friend-list">
        ${
          filteredFriends.length === 0
            ? `<div class="empty-state">${
                friends.length === 0
                  ? 'You have not added any friends yet.'
                  : 'No friends match your search.'
              }</div>`
            : filteredFriends
                .map((friend) => {
                  return `
                    <article class="friend-item">
                      <div>
                        <strong>${escapeHtml(friend.username)}</strong>
                        <span class="friend-status">${statusLabel(friend.status)} · ${friend.record.wins}:${friend.record.losses}</span>
                      </div>
                      <div class="friend-actions">
                        <button class="btn btn-ghost" data-action="open-profile" data-origin="friends" data-username="${friend.username}">View profile</button>
                        <button class="btn btn-ghost btn-danger" data-action="remove-friend" data-username="${friend.username}">Remove</button>
                      </div>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Add a friend</h3>
        <span>Mock accounts & real duel invites</span>
      </div>
      <form id="add-friend-form" class="form-row">
        <div class="form-field">
          <label for="friend-name">Username</label>
          <input
            type="text"
            id="friend-name"
            name="username"
            minlength="3"
            maxlength="24"
            required
            placeholder="e.g. FlipMaster"
            value="${escapeHtml(friendDraft)}"
            autocomplete="off"
          />
        </div>
        <div class="form-field" style="align-self:flex-end;">
          <button type="submit" class="btn btn-primary">Add friend</button>
        </div>
      </form>
      <div class="section-title" style="margin-top:1.5rem;">
        <h3>Suggested players</h3>
        <span>Community regulars</span>
      </div>
      <div class="friend-list">
        ${
          suggestions.length === 0
            ? '<div class="empty-state">No more suggestions right now.</div>'
            : suggestions
                .map((friend) => {
                  return `
                    <article class="friend-item">
                      <div>
                        <strong>${escapeHtml(friend.username)}</strong>
                        <span class="friend-status">${statusLabel(friend.status)} · ${friend.record.wins}:${friend.record.losses}</span>
                      </div>
                      <button class="btn btn-ghost" data-action="open-profile" data-origin="friends" data-username="${friend.username}">View profile</button>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;
  queueMicrotask(() => {
    const search = document.getElementById('friend-search');
    if (search instanceof HTMLInputElement) {
      if (state.friendSearchFocused) {
        const caret = typeof state.friendSearchCaret === 'number' ? state.friendSearchCaret : search.value.length;
        search.focus();
        search.setSelectionRange(caret, caret);
      }
    }
  });
}

function renderTournamentsView() {
  const tournaments = state.tournaments || [];
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Tournament hub</h3>
        <span>Re-enter whenever you like — the top three share 90% of the pot</span>
      </div>
      <div class="tournament-peek">
        ${
          tournaments.length === 0
            ? '<div class="empty-state">No tournaments have been announced yet.</div>'
            : tournaments
                .map((tournament) => {
                  const statusText = tournamentStatusLabel(tournament.status);
                  const joinDisabled = tournament.status === 'completed';
                  const joinLabel = joinDisabled
                    ? 'Tournament finished'
                    : tournament.userEntries > 0
                    ? 'Play again'
                    : 'Play now';
                  const leaders = tournament.leaderboard || [];
                  const leaderboard =
                    leaders.length === 0
                      ? '<li class="empty-state">Standings appear as soon as the first games finish.</li>'
                      : leaders
                          .slice(0, 5)
                          .map(
                            (entry) => `
                              <li class="leaderboard__item">
                                <span>${entry.rank}. ${escapeHtml(entry.username)}</span>
                                <span>${entry.score} pts · ${entry.entries}x</span>
                              </li>
                            `
                          )
                          .join('');
                  const payoutNote =
                    tournament.status === 'completed' && tournament.payouts && tournament.payouts.length > 0
                      ? `<p class="subtitle">Top 3 payouts: ${tournament.payouts
                          .map((payout, index) => `#${index + 1} ${escapeHtml(payout.username)} ${formatPi(payout.reward)}`)
                          .join(', ')}</p>`
                      : '';
                  const scheduleLabel =
                    tournament.status === 'completed'
                      ? `Wrapped ${timeAgo(tournament.completedAt)} ago`
                      : 'Live now';
                  return `
                    <article class="tournament-card">
                      <header class="tournament-card__header">
                        <div>
                          <strong>${escapeHtml(tournament.title)}</strong>
                          <span class="badge">${escapeHtml(tournament.style)}</span>
                        </div>
                        <span class="badge badge--accent">${formatPi(tournament.entryFee)} buy-in</span>
                      </header>
                        <p class="subtitle">${escapeHtml(tournament.location)} · ${scheduleLabel}</p>
                        <p class="subtitle">Status ${statusText} · Pot ${formatPi(tournament.currentPot || 0)} · Entries ${tournament.totalEntries} · Your runs ${
                    tournament.userEntries || 0
                  } · House share ${formatPi(tournament.houseCut || 0)}</p>
                      <ul class="leaderboard leaderboard--compact">${leaderboard}</ul>
                      ${payoutNote}
                      <button class="btn ${joinDisabled ? 'btn-ghost' : 'btn-primary'}" data-action="join-tournament" data-tournament="${tournament.id}" ${
                        joinDisabled ? 'disabled' : ''
                      }>${joinLabel}</button>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;
}

function renderChatView() {
  const messages = state.chatMessages || [];
  const previousLog = document.querySelector('.chat-log');
  let previousOffset = null;
  let wasAtBottom = state.chatStickToBottom;
  if (previousLog) {
    wasAtBottom =
      previousLog.scrollTop + previousLog.clientHeight >= previousLog.scrollHeight - 24 || state.chatStickToBottom;
    previousOffset = previousLog.scrollHeight - previousLog.scrollTop;
  }
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Astra community chat</h3>
        <span>Share match highlights and rally new rivals</span>
      </div>
      <div class="chat-log">
        ${
          messages.length === 0
            ? '<div class="empty-state">Kick off the conversation and rally the Astra Games community.</div>'
            : messages
                .map((entry) => {
                  return `
                    <article class="chat-bubble">
                      <div class="chat-bubble__meta">
                        <strong>${escapeHtml(entry.username)}</strong>
                        <span>${timeAgo(entry.timestamp)}</span>
                      </div>
                      <p>${escapeHtml(entry.message)}</p>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
      <form id="chat-form" class="chat-form">
        <input type="text" name="message" placeholder="Type a message..." maxlength="240" required value="${escapeHtml(state.chatInput)}" />
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
    </section>
  `;
  queueMicrotask(() => {
    const log = document.querySelector('.chat-log');
    if (!log) return;
    if (state.chatShouldScrollToBottom || wasAtBottom) {
      log.scrollTop = log.scrollHeight;
    } else if (previousOffset !== null) {
      log.scrollTop = Math.max(0, log.scrollHeight - previousOffset);
    }
    state.chatShouldScrollToBottom = false;
    const input = document.querySelector('#chat-form input[name="message"]');
    if (input instanceof HTMLInputElement && state.chatInputFocused) {
      const caret = typeof state.chatCaret === 'number' ? state.chatCaret : input.value.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    }
  });
}

function renderProfileView() {
  const profile = state.profile;
  if (!profile || !profile.user) {
    appEl.innerHTML = '<div class="card"><div class="empty-state">Loading profile...</div></div>';
    return;
  }
  const { user, games, friends } = profile;
  const stats = user.stats || { wins: 0, losses: 0, netEarnings: 0 };
  const friendCount = friends.length;
  const netEarnings = typeof stats.netEarnings === 'number' ? stats.netEarnings : 0;
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>${escapeHtml(user.username)}</h3>
        <span>${escapeHtml(user.tagline || 'Astra Duelist')}</span>
      </div>
      <p class="subtitle">${escapeHtml(user.bio || 'Mock profile for the Astra Games universe.')}</p>
      <div class="grid grid--three" style="margin-top:1.2rem;">
        ${renderStat('Balance', formatPi(user.balance))}
        ${renderStat('Wins', stats.wins || 0)}
        ${renderStat('Losses', stats.losses || 0)}
        ${renderStat('Friends', friendCount)}
        ${renderStat('Net π', formatPi(netEarnings, true))}
      </div>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Recent matches</h3>
        <span>${games.length} records</span>
      </div>
      <div class="grid">
        ${
          games.length === 0
            ? '<div class="empty-state">No matches have been recorded yet.</div>'
            : games
                .slice(0, 6)
                .map((game) => renderGameSummary(game, { allowOpen: false }))
                .join('')
        }
      </div>
    </section>
    <section class="card card--secondary">
      <div class="section-title">
        <h3>Manage friendships</h3>
        <span>Visit the Friends view for invites and removals</span>
      </div>
      <p class="subtitle">Profiles focus on stats and match history. Jump to the Friends tab to add or remove contacts.</p>
    </section>
  `;
}

function renderGameView() {
  const game = state.currentGame;
  if (!game) {
    appEl.innerHTML = '<div class="card"><div class="empty-state">Loading match...</div></div>';
    return;
  }
  const you = game.players.find((player) => player.id === state.user.id);
  const opponent = game.players.find((player) => player.id !== state.user.id);
  const rounds = game.rounds || [];
  const currentRound = rounds.find((round) => !round.result);
  const remaining = currentRound && currentRound.deadline ? Math.max(0, Math.floor((currentRound.deadline - Date.now()) / 1000)) : null;

  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>${escapeHtml(you?.username || 'You')} vs ${escapeHtml(opponent?.username || 'Opponent')}</h3>
        <span>${escapeHtml(game.gameLabel || 'RPS duel')} · ${
          game.status === 'completed' ? resultLabel(game) : 'Best-of-3 · 10s timer'
        }</span>
      </div>
      <div class="game-layout">
        <article class="player-card">
          <h4>${escapeHtml(you?.username || 'You')}</h4>
          <p class="subtitle">Score ${you?.score ?? 0}</p>
          <div class="move-buttons">
            <button class="btn btn-primary" data-action="submit-move" data-move="rock" ${game.canMove ? '' : 'disabled'}>🪨 Rock</button>
            <button class="btn btn-primary" data-action="submit-move" data-move="paper" ${game.canMove ? '' : 'disabled'}>📄 Paper</button>
            <button class="btn btn-primary" data-action="submit-move" data-move="scissors" ${game.canMove ? '' : 'disabled'}>✂️ Scissors</button>
          </div>
        </article>
        <article class="player-card">
          <h4>${escapeHtml(opponent?.username || 'Opponent')}</h4>
          <p class="subtitle">Score ${opponent?.score ?? 0}</p>
          <p class="subtitle">${game.status === 'completed' ? resultLabel(game) : 'Waiting for moves...'}</p>
        </article>
        <article class="player-card">
          <h4>Rounds</h4>
          <div class="round-log">
            ${
              rounds.length === 0
                ? '<div class="empty-state">Round details appear as soon as both players lock their moves.</div>'
                : rounds
                    .map((round) => {
                      const youMoveRaw = you ? round.moves[you.username] : null;
                      const oppMoveRaw = opponent ? round.moves[opponent.username] : null;
                      const youMove = youMoveRaw ? moveLabel(youMoveRaw) : '—';
                      const oppMove = oppMoveRaw ? moveLabel(oppMoveRaw) : '❔';
                      const result = round.result ? roundResultLabel(round.result, you?.id) : 'Pending';
                      return `<div class="round-log__item"><span>R${round.number}: ${result}</span><span>${youMove} · ${oppMove}</span></div>`;
                    })
                    .join('')
            }
          </div>
        </article>
      </div>
      <div class="section-title" style="margin-top:1.4rem;">
        <span class="timer">${game.status === 'completed' ? 'Match complete' : remaining !== null ? `${remaining}s` : ''}</span>
        <button class="btn btn-ghost" data-view="dashboard">Back to dashboard</button>
      </div>
    </section>
  `;
}

function renderStat(label, value) {
  return `<div class="stat-pill"><h4>${label}</h4><strong>${value}</strong></div>`;
}

function renderGameSummary(game, options = {}) {
  const opponentRaw = game.opponent;
  const opponentName =
    typeof opponentRaw === 'string'
      ? opponentRaw
      : opponentRaw && opponentRaw.username
      ? opponentRaw.username
      : '—';
  const { allowOpen = game.status === 'in_progress' } = options;
  const result =
    game.status === 'in_progress'
      ? 'In progress'
      : game.result === 'win'
      ? 'Win'
      : game.result === 'loss'
      ? 'Loss'
      : 'Completed';
  const badge =
    game.status === 'in_progress'
      ? 'badge badge--neutral'
      : game.result === 'win'
      ? 'badge badge--accent'
      : 'badge';
  const youScoreRaw =
    game.youScore !== undefined
      ? game.youScore
      : typeof game.score === 'string'
      ? Number.parseInt(game.score.split('-')[0], 10) || 0
      : 0;
  const opponentScoreRaw =
    game.opponentScore !== undefined
      ? game.opponentScore
      : typeof game.score === 'string'
      ? Number.parseInt(game.score.split('-')[1], 10) || 0
      : 0;
  const entryFee = typeof game.tournamentEntryFee === 'number' ? game.tournamentEntryFee : null;
  const stakeValue = entryFee !== null ? entryFee : game.stake;
  const stakeLabel = entryFee !== null ? 'Entry' : 'Buy-in';
  const prizePool = entryFee !== null ? game.tournamentPot : null;
  const fallbackPot = game.pot;
  let potValue;
  if (entryFee !== null) {
    if (prizePool !== null && prizePool !== undefined) {
      potValue = prizePool;
    } else if (fallbackPot !== null && fallbackPot !== undefined) {
      potValue = fallbackPot;
    } else {
      potValue = null;
    }
  } else {
    potValue = fallbackPot;
  }
  const potLabel = entryFee !== null ? 'Prize pool' : 'Pot';
  const potDisplay =
    potValue === null || potValue === undefined ? '' : ` · ${potLabel} ${formatPi(potValue)}`;
  return `
    <article class="game-summary">
      <div class="game-summary__header">
        <div class="game-summary__meta">
          <strong>${escapeHtml(opponentName)}</strong>
          <span class="score-pill">${youScoreRaw} : ${opponentScoreRaw}</span>
        </div>
        <span class="${badge}">${result}</span>
      </div>
      <p class="subtitle">${escapeHtml(game.gameLabel || 'RPS duel')} · ${stakeLabel} ${formatPi(stakeValue)}${potDisplay}</p>
      ${
        allowOpen
          ? `<button class="btn btn-ghost" data-action="open-game" data-game="${game.id}">${
              game.status === 'in_progress' ? 'Resume match' : 'View match'
            }</button>`
          : ''
      }
    </article>
  `;
}

async function handleCreateLobby(form) {
  const stakeValue = Number(form.stake.value);
  if (Number.isNaN(stakeValue) || stakeValue <= 0) return;
  const gameType = form.gameType ? form.gameType.value : 'rps_pvp';
  try {
    await api('/api/lobbies', {
      method: 'POST',
      body: { stake: stakeValue, gameType },
    });
    showToast('Lobby created!');
    form.reset();
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Failed to create lobby', true);
  }
}

async function handleCreateAiMatch(form) {
  const stakeValue = Number(form.stake.value);
  if (Number.isNaN(stakeValue) || stakeValue <= 0) return;
  try {
    const { game } = await api('/api/ai/challenge', {
      method: 'POST',
      body: { stake: stakeValue },
    });
    showToast('AI challenge launched!');
    form.reset();
    await refreshDashboard();
    if (game && game.id) {
      await openGame(game.id);
    }
  } catch (error) {
    showToast(error.message || 'Failed to start AI challenge', true);
  }
}

async function joinLobby(lobbyId) {
  try {
    const { game } = await api(`/api/lobbies/${encodeURIComponent(lobbyId)}/join`, { method: 'POST' });
    showToast('Joined lobby!');
    await refreshDashboard();
    if (game && game.id) {
      await openGame(game.id);
    }
  } catch (error) {
    showToast(error.message || 'Failed to join lobby', true);
  }
}

async function cancelLobby(lobbyId) {
  try {
    await api(`/api/lobbies/${encodeURIComponent(lobbyId)}`, { method: 'DELETE' });
    showToast('Lobby closed.');
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Failed to close lobby', true);
  }
}

async function openGame(gameId, { preserveView = false } = {}) {
  try {
    const { game } = await api(`/api/games/${gameId}`);
    state.currentGameId = gameId;
    state.currentGame = game;
    if (!preserveView) {
      state.view = 'game';
    }
    startGamePolling(gameId);
    render();
  } catch (error) {
    showToast(error.message || 'Failed to open game', true);
  }
}

async function submitMove(gameId, move) {
  try {
    const { game } = await api(`/api/games/${gameId}/move`, {
      method: 'POST',
      body: { move },
    });
    state.currentGame = game;
    showToast('Move submitted!');
    render();
  } catch (error) {
    showToast(error.message || 'Failed to submit move', true);
  }
}

function startGamePolling(gameId) {
  stopGamePolling();
  state.gamePollHandle = setInterval(async () => {
    try {
      const { game } = await api(`/api/games/${gameId}`);
      state.currentGame = game;
      if (game.status === 'completed') {
        stopGamePolling();
        showToast(resultLabel(game));
      }
      if (state.view === 'game') {
        render();
      }
    } catch (error) {
      console.error('Game poll failed', error);
      stopGamePolling();
    }
  }, GAME_INTERVAL);
}

function stopGamePolling() {
  if (state.gamePollHandle) {
    clearInterval(state.gamePollHandle);
    state.gamePollHandle = null;
  }
}

async function joinTournament(id) {
  try {
    const payload = await api(`/api/tournaments/${encodeURIComponent(id)}/join`, { method: 'POST' });
    showToast('Joined the tournament!');
    if (payload && payload.tournament) {
      state.tournaments = state.tournaments.map((item) => (item.id === id ? payload.tournament : item));
    }
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Failed to join tournament', true);
  }
}

async function handleChatSubmit(form) {
  const message = form.message.value.trim();
  if (!message) return;
  try {
    const payload = await api('/api/chat', {
      method: 'POST',
      body: { message },
    });
    state.chatMessages = payload.messages || [];
    state.chatInput = '';
    state.chatShouldScrollToBottom = true;
    state.chatInputFocused = true;
    state.chatCaret = 0;
    form.reset();
    render();
  } catch (error) {
    showToast(error.message || 'Failed to send message', true);
  }
}

async function handleAddFriend(form) {
  const username = form.username.value.trim();
  if (!username) return;
  try {
    const payload = await api('/api/friends', {
      method: 'POST',
      body: { username },
    });
    state.friends = payload.friends || [];
    state.friendSuggestions = payload.suggestions || [];
    state.friendDraft = '';
    form.reset();
    showToast(`${username} added as a friend!`);
    render();
  } catch (error) {
    showToast(error.message || 'Failed to add friend', true);
  }
}

async function removeFriend(username) {
  try {
    const payload = await api(`/api/friends/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    });
    state.friends = payload.friends || [];
    state.friendSuggestions = payload.suggestions || [];
    showToast(`${username} removed from friends.`);
    render();
  } catch (error) {
    showToast(error.message || 'Failed to remove friend', true);
  }
}

async function loadProfile(username) {
  try {
    const profile = await api(`/api/profile/${encodeURIComponent(username)}`);
    state.profile = profile;
    if (state.view === 'profile') {
      render();
    }
  } catch (error) {
    showToast(error.message || 'Profile not found', true);
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout failed', error);
  }
  resetState();
  render();
}

function updateNavVisibility() {
  if (!navEl) return;
  const buttons = navEl.querySelectorAll('button[data-view]');
  buttons.forEach((button) => {
    const view = button.getAttribute('data-view');
    if (view === 'logout') {
      button.disabled = !state.user;
    } else {
      button.disabled = !state.user && view !== 'dashboard';
    }
  });
}

function updateNavActive() {
  if (!navEl) return;
  const buttons = navEl.querySelectorAll('button[data-view]');
  buttons.forEach((button) => {
    const view = button.getAttribute('data-view');
    if (view === state.activeNav) {
      button.classList.add('nav-link--active');
    } else {
      button.classList.remove('nav-link--active');
    }
  });
}

function updateUserBadge() {
  if (!userBadge) return;
  if (!state.user) {
    userBadge.innerHTML = '<span class="badge">Not signed in</span>';
    return;
  }
  userBadge.innerHTML = `
    <span>${escapeHtml(state.user.username)}</span>
    <span class="badge">${formatPi(state.user.balance)}</span>
  `;
}

async function api(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Error (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

let toastTimer = null;
function showToast(message, isError = false) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2600);
}

function moveLabel(move) {
  switch (move) {
    case 'rock':
      return 'Rock';
    case 'paper':
      return 'Paper';
    case 'scissors':
      return 'Scissors';
    default:
      return '—';
  }
}

function roundResultLabel(result, viewerId) {
  if (!result) return 'Pending';
  if (!result.winnerId) {
    return result.reason === 'timeout' ? 'AFK win' : 'Draw';
  }
  return result.winnerId === viewerId ? 'Win' : 'Loss';
}

function statusLabel(status) {
  switch (status) {
    case 'online':
      return 'Online';
    case 'in_game':
      return 'In game';
    default:
      return 'Offline';
  }
}

function tournamentStatusLabel(status) {
  switch (status) {
    case 'running':
      return 'Live';
    case 'completed':
      return 'Completed';
    default:
      return 'Upcoming';
  }
}

function resultLabel(game) {
  if (!game) return '';
  if (game.status !== 'completed') return 'Match in progress';
  if (game.winnerId === state.user.id) {
    return 'You won!';
  }
  if (game.winnerId) {
    return 'Defeat this time';
  }
  return 'Match complete';
}

function formatPi(value, includeSign = false) {
  const amount = Number(value) || 0;
  const formatted = `${amount.toFixed(2)} π`;
  if (!includeSign) return formatted;
  if (amount > 0) return `+${formatted}`;
  return formatted;
}

function svgDataUri(svg) {
  if (!svg) return '';
  const compact = svg.replace(/\s+/g, ' ').trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(timestamp) {
  const diff = Date.now() - Number(timestamp || 0);
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
