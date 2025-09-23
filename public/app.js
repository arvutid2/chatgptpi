const state = {
  user: null,
  lobbies: [],
  games: [],
  view: 'dashboard',
  currentGameId: null,
  currentGame: null,
  pollHandle: null,
  gamePollHandle: null,
  profile: null,
  profileLoading: false,
  friends: [],
  friendSuggestions: [],
  tournaments: [],
  chatMessages: [],
  chatInput: '',
  theme: 'dark',
  practiceGame: null,
};

const MOVES = [
  { key: 'rock', label: 'Kivi 🪨' },
  { key: 'paper', label: 'Paber 📄' },
  { key: 'scissors', label: 'Käärid ✂️' },
];

const WIN_RULES = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

const THEME_KEY = 'pi-duel-theme';
const DASHBOARD_MAX_RETRIES = 3;
const DASHBOARD_RETRY_BASE_MS = 1500;

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');
const navBar = document.querySelector('.sidebar__nav');
const themeToggle = document.getElementById('theme-toggle');

let dashboardRetryAttempts = 0;
let dashboardRetryTimeout = null;
let dashboardFetchInFlight = false;

if (navBar) {
  navBar.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-view]');
    if (!button || button.disabled) return;
    const view = button.getAttribute('data-view');
    if (view === 'logout') {
      if (!state.user) return;
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (error) {
        console.error('Logout failed', error);
      }
      stopPolling();
      resetState();
      render();
      return;
    }
    if (view === 'profile') {
      if (!state.user) return;
      state.view = 'profile';
      loadProfile(state.user.username);
      return;
    }
    if (view) {
      state.view = view;
      if (view === 'friends' && state.user) {
        fetchFriends();
      }
      if (view === 'tournaments' && state.user) {
        fetchTournaments();
      }
      if (view === 'chat' && state.user) {
        fetchChat();
      }
      if (view === 'dashboard') {
        state.profile = null;
      }
      render();
    }
  });
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else if (state.user) {
    startPolling();
  }
});

init();

async function init() {
  state.theme = loadThemePreference();
  applyTheme(state.theme);
  state.practiceGame = createPracticeGame();
  updateThemeToggle();
  await refreshSession();
  if (state.user) {
    startPolling();
  }
  render();
}

function loadThemePreference() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'dark';
}

function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', value);
}

function setTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, state.theme);
  applyTheme(state.theme);
  updateThemeToggle();
}

function updateThemeToggle() {
  if (!themeToggle) return;
  const label = themeToggle.querySelector('.theme-toggle__label');
  const icon = themeToggle.querySelector('.theme-toggle__icon');
  if (state.theme === 'light') {
    if (label) label.textContent = 'Light';
    if (icon) icon.textContent = '☀️';
  } else {
    if (label) label.textContent = 'Dark';
    if (icon) icon.textContent = '🌙';
  }
}

function resetState() {
  state.user = null;
  state.lobbies = [];
  state.games = [];
  state.view = 'dashboard';
  state.currentGameId = null;
  state.currentGame = null;
  state.profile = null;
  state.friends = [];
  state.friendSuggestions = [];
  state.tournaments = [];
  state.chatMessages = [];
  state.chatInput = '';
  state.practiceGame = createPracticeGame();
  updateNavVisibility();
  dashboardRetryAttempts = 0;
  dashboardFetchInFlight = false;
  if (dashboardRetryTimeout) {
    clearTimeout(dashboardRetryTimeout);
    dashboardRetryTimeout = null;
  }
}

function startPolling() {
  stopPolling();
  dashboardRetryAttempts = 0;
  fetchDashboard();
  state.pollHandle = setInterval(fetchDashboard, 4000);
  if (state.currentGameId) {
    startGamePolling(state.currentGameId);
  }
}

function stopPolling() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
  if (state.gamePollHandle) {
    clearInterval(state.gamePollHandle);
    state.gamePollHandle = null;
  }
  if (dashboardRetryTimeout) {
    clearTimeout(dashboardRetryTimeout);
    dashboardRetryTimeout = null;
  }
}

async function refreshSession() {
  try {
    const { user } = await api('/api/auth/session');
    state.user = user;
    updateNavVisibility();
  } catch (error) {
    console.error('Failed to load session', error);
  }
}

async function fetchDashboard() {
  if (!state.user) return;
  if (dashboardFetchInFlight) return;
  dashboardFetchInFlight = true;
  try {
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
    if (friendsRes) {
      state.friends = friendsRes.friends || [];
      state.friendSuggestions = friendsRes.suggestions || [];
    }
    if (tournamentsRes) {
      state.tournaments = tournamentsRes.tournaments || [];
    }
    if (chatRes && Array.isArray(chatRes.messages)) {
      state.chatMessages = chatRes.messages;
    }
    updateNavVisibility();
    if (state.view === 'profile' && state.profile) {
      loadProfile(state.profile.user.username);
    }
    dashboardRetryAttempts = 0;
    if (dashboardRetryTimeout) {
      clearTimeout(dashboardRetryTimeout);
      dashboardRetryTimeout = null;
    }
    render();
  } catch (error) {
    console.error('Failed to refresh dashboard', error);
    if (error.status === 401) {
      stopPolling();
      resetState();
      render();
    } else {
      dashboardRetryAttempts += 1;
      if (dashboardRetryAttempts === 1) {
        console.warn('Dashboard refresh failed, attempting retry.');
      }
      if (dashboardRetryAttempts <= DASHBOARD_MAX_RETRIES) {
        const retryDelay = DASHBOARD_RETRY_BASE_MS * Math.pow(2, dashboardRetryAttempts - 1);
        if (dashboardRetryTimeout) {
          clearTimeout(dashboardRetryTimeout);
        }
        dashboardRetryTimeout = setTimeout(() => {
          dashboardRetryTimeout = null;
          if (state.user) {
            fetchDashboard();
          }
        }, retryDelay);
      } else if (dashboardRetryAttempts === DASHBOARD_MAX_RETRIES + 1) {
        showToast('Serveriga ühendus lonkab. Kontrolli võrku või proovi hiljem uuesti.', true);
      }
      dashboardRetryAttempts = Math.min(dashboardRetryAttempts, DASHBOARD_MAX_RETRIES + 1);
    }
  } finally {
    dashboardFetchInFlight = false;
  }
}

async function fetchFriends() {
  if (!state.user) return;
  try {
    const data = await api('/api/friends');
    state.friends = data.friends || [];
    state.friendSuggestions = data.suggestions || [];
    if (state.view === 'friends' || state.view === 'dashboard') {
      render();
    }
  } catch (error) {
    console.error('Failed to load friends', error);
  }
}

async function fetchTournaments() {
  if (!state.user) return;
  try {
    const data = await api('/api/tournaments');
    state.tournaments = data.tournaments || [];
    if (state.view === 'tournaments' || state.view === 'dashboard') {
      render();
    }
  } catch (error) {
    console.error('Failed to load tournaments', error);
  }
}

async function fetchChat() {
  if (!state.user) return;
  try {
    const data = await api('/api/chat');
    state.chatMessages = data.messages || [];
    if (state.view === 'chat' || state.view === 'dashboard') {
      render();
    }
  } catch (error) {
    console.error('Failed to load chat', error);
  }
}

async function addFriendByUsername(username) {
  if (!state.user || !username) return;
  try {
    const data = await api('/api/friends', {
      method: 'POST',
      body: { username },
    });
    state.friends = data.friends || [];
    state.friendSuggestions = data.suggestions || state.friendSuggestions;
    showToast(`${username} lisatud sõbraks!`, false);
    if (state.view === 'friends' || state.view === 'dashboard') {
      render();
    }
  } catch (error) {
    showToast(error.message || 'Sõbra lisamine ebaõnnestus', true);
  }
}

async function joinTournamentById(tournamentId) {
  if (!state.user || !tournamentId) return;
  try {
    const { tournament } = await api(`/api/tournaments/${tournamentId}/join`, {
      method: 'POST',
      body: {},
    });
    showToast(`Liitusid turniiriga ${tournament.title}!`, false);
    await fetchDashboard();
  } catch (error) {
    showToast(error.message || 'Turniiriga liitumine ebaõnnestus', true);
  }
}

async function sendChatMessage(message) {
  if (!state.user) return;
  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: { message },
    });
    state.chatMessages = data.messages || [];
    state.chatInput = '';
    if (state.view === 'chat' || state.view === 'dashboard') {
      render();
    }
  } catch (error) {
    showToast(error.message || 'Sõnumi saatmine ebaõnnestus', true);
  }
}

function updateNavVisibility() {
  if (!navBar) return;
  const buttons = navBar.querySelectorAll('button[data-view]');
  if (state.user) {
    navBar.classList.remove('hidden');
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  } else {
    navBar.classList.add('hidden');
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
  }
  updateNavActive();
}

function updateNavActive() {
  if (!navBar) return;
  const activeView = state.view === 'game' ? 'dashboard' : state.view;
  const buttons = navBar.querySelectorAll('[data-view]');
  buttons.forEach((btn) => {
    const view = btn.getAttribute('data-view');
    if (!state.user) {
      btn.classList.remove('sidebar__link--active');
      return;
    }
    if (view === 'logout') {
      btn.classList.remove('sidebar__link--active');
      return;
    }
    if (view === activeView) {
      btn.classList.add('sidebar__link--active');
    } else {
      btn.classList.remove('sidebar__link--active');
    }
  });
}

function render() {
  updateThemeToggle();
  if (!state.user) {
    renderLogin();
    updateNavActive();
    return;
  }
  switch (state.view) {
    case 'game':
      renderGame();
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
      renderProfile();
      break;
    default:
      renderDashboard();
      break;
  }
  updateNavActive();
}

function renderLogin() {
  appEl.innerHTML = `
    <section class="card" aria-labelledby="login-title">
      <h2 id="login-title">Logi sisse</h2>
      <p class="subtitle">Sisesta oma kasutajanimi, et alustada mock-kogemust.</p>
      <form id="login-form" class="login-form">
        <label for="username">Kasutajanimi</label>
        <input type="text" id="username" name="username" minlength="3" maxlength="24" required placeholder="nt. pi-warrior" />
        <button type="submit" class="primary">Alusta duelle</button>
      </form>
    </section>
  `;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = form.username.value.trim();
    if (!username) return;
    try {
      const { user } = await api('/api/auth/login', {
        method: 'POST',
        body: { username },
      });
      state.user = user;
      updateNavVisibility();
      state.view = 'dashboard';
      showToast(`Tere tulemast, ${user.username}!`, false);
      startPolling();
      render();
    } catch (error) {
      showToast(error.message || 'Login ebaõnnestus', true);
    }
  });
}

function renderDashboard() {
  const { stats } = state.user;
  const netClass = stats.netEarnings > 0 ? 'balance--positive' : stats.netEarnings < 0 ? 'balance--negative' : '';
  const activeGames = state.games.filter((game) => game.status === 'in_progress');
  const recentGames = state.games.filter((game) => game.status === 'completed').slice(0, 5);
  const friendsPreview = state.friends.slice(0, 3);
  const tournamentsPreview = state.tournaments.slice(0, 2);
  const chatPreview = state.chatMessages.slice(-3);
  const practice = state.practiceGame || createPracticeGame();
  const practiceHistory = (practice.rounds || []).slice(0, 5);
  const practiceStatus = practice.lastOutcome ? practiceResultLabel(practice.lastOutcome.result) : 'Vali käik ja testime AI vastu.';
  const practiceDetail = practice.lastOutcome
    ? `Sina: ${moveLabel(practice.lastOutcome.playerMove)} · AI: ${moveLabel(practice.lastOutcome.aiMove)}`
    : 'AI reageerib sinu mustritele ja kohandub iga sammuga.';
  const streakLabel = practice.streak > 1 ? `Streak: ${practice.streak}` : 'Alustame!';

  const friendPreviewHtml =
    friendsPreview.length === 0
      ? '<div class="empty-state">Lisa sõpru, et näha nende staatust ja rekordit.</div>'
      : friendsPreview
          .map((friend) => {
            const statusClass = friend.status === 'online' ? 'friend-pill--online' : 'friend-pill--offline';
            const record = friend.record || { wins: 0, losses: 0 };
            return `
              <button class="friend-pill ${statusClass}" data-open-profile="${escapeHtml(friend.username)}">
                <span class="friend-pill__avatar">${escapeHtml(friend.avatar || '🥞')}</span>
                <span>
                  <strong>${escapeHtml(friend.username)}</strong>
                  <small>${friend.status === 'online' ? 'Online' : 'Offline'} · ${record.wins}:${record.losses}</small>
                </span>
              </button>
            `;
          })
          .join('');

  const tournamentPreviewHtml =
    tournamentsPreview.length === 0
      ? '<div class="empty-state">Hetkel pole ühtegi turniiri avatud.</div>'
      : tournamentsPreview
          .map((tournament, index) => {
            const toneClass = index % 2 === 0 ? 'tag--primary' : 'tag--accent';
            return `
              <article class="tournament-preview ${tournament.isRegistered ? 'tournament-preview--joined' : ''}" data-join-tournament="${escapeHtml(tournament.id)}">
                <div>
                  <h4>${escapeHtml(tournament.title)}</h4>
                  <p class="subtitle">${escapeHtml(tournament.style)} · ${escapeHtml(tournament.location)}</p>
                </div>
                <div class="tournament-preview__meta">
                  <span class="tag ${toneClass}">${tournament.entryFee} π</span>
                  <span class="subtitle">${tournament.participants}/${tournament.slots}</span>
                </div>
              </article>
            `;
          })
          .join('');

  const chatPreviewHtml =
    chatPreview.length === 0
      ? '<div class="empty-state">Chat ootab sinu esimest sõnumit.</div>'
      : chatPreview
          .map(
            (message) => `
              <div class="chat-preview__item">
                <span class="chat-preview__avatar">${escapeHtml(message.avatar || '🥞')}</span>
                <div>
                  <strong>${escapeHtml(message.username)}</strong>
                  <p class="subtitle">${escapeHtml(message.message)}</p>
                </div>
              </div>
            `
          )
          .join('');

  const practiceHistoryHtml =
    practiceHistory.length === 0
      ? '<li class="practice-history__item practice-history__item--empty">Esita käik ja jälgi, kuidas AI reageerib.</li>'
      : practiceHistory
          .map(
            (entry) => `
              <li class="practice-history__item practice-history__item--${entry.result}">
                <span class="practice-history__moves">${moveLabel(entry.playerMove)} vs ${moveLabel(entry.aiMove)}</span>
                <span class="practice-history__result">${practiceResultLabel(entry.result)}</span>
              </li>
            `
          )
          .join('');

  appEl.innerHTML = `
    <section class="card hero-card">
      <div class="hero-card__content">
        <span class="hero-chip">🔥 Live MVP</span>
        <h2>PancakeSwap stiilis duellihub</h2>
        <p>Mock Pi tokenid, escrow ja AFK kaitse ühes kohas. Katseta, väljakutse sõpru ja naudi siirupist UI-d.</p>
        <div class="hero-metrics">
          <div>
            <span class="hero-metric">${stats.wins}</span>
            <span class="hero-metric__label">Võidud</span>
          </div>
          <div>
            <span class="hero-metric">${stats.gamesPlayed}</span>
            <span class="hero-metric__label">Mänge</span>
          </div>
          <div>
            <span class="hero-metric">${stats.netEarnings.toFixed(2)} π</span>
            <span class="hero-metric__label">Netovõit</span>
          </div>
        </div>
      </div>
      <div class="hero-card__visual" aria-hidden="true">
        <div class="hero-orb hero-orb--primary"></div>
        <div class="hero-orb hero-orb--secondary"></div>
        <div class="hero-waffle">🥞</div>
      </div>
    </section>

    <section class="dashboard-grid">
      <div class="dashboard-column">
        <article class="card stats-card">
          <h2>Minu konto</h2>
          <p class="subtitle">Mock Pi saldo: <strong class="balance">${state.user.balance.toFixed(2)} π</strong></p>
          <div class="stat-grid">
            <div>
              <span class="stat-label">Võidud</span>
              <span class="stat-value">${stats.wins}</span>
            </div>
            <div>
              <span class="stat-label">Kaotused</span>
              <span class="stat-value">${stats.losses}</span>
            </div>
            <div>
              <span class="stat-label">Mängud</span>
              <span class="stat-value">${stats.gamesPlayed}</span>
            </div>
            <div>
              <span class="stat-label">Netovõit</span>
              <span class="stat-value ${netClass}">${stats.netEarnings.toFixed(2)} π</span>
            </div>
          </div>
        </article>

        <article class="card lobby-hub">
          <div class="section-header">
            <h2>Lobby hub</h2>
            <span class="tag">Escrow 90/10</span>
          </div>
          <div class="lobby-hub__grid">
            <div class="lobby-hub__col">
              <h3>Loo uus lobby</h3>
              <p class="subtitle">Määra buy-in ja jaga linki sõpradele.</p>
              <form id="create-lobby-form" class="lobby-form">
                <label for="buy-in">Buy-in (π)</label>
                <input type="number" id="buy-in" name="buyIn" min="1" step="1" required placeholder="nt. 25" />
                <button type="submit" class="primary">Loo lobby</button>
              </form>
              ${state.user.lobbyId ? '<p class="subtitle">Sul on aktiivne lobby – vaata allpool.</p>' : ''}
            </div>
            <div class="practice-arena" id="practice-arena">
              <div class="practice-arena__header">
                <h3>AI proovimäng</h3>
                <button class="link-btn" data-practice-reset>Alusta uuesti</button>
              </div>
              <p class="subtitle">Katseta RPS mehaanikat enne pärisduelle.</p>
              <div class="practice-arena__score">
                <div>
                  <span class="practice-score">${practice.playerScore}</span>
                  <span class="practice-label">Sina</span>
                </div>
                <div class="practice-streak">${streakLabel}</div>
                <div>
                  <span class="practice-score">${practice.aiScore}</span>
                  <span class="practice-label">Pi Duel AI</span>
                </div>
              </div>
              <div class="move-buttons practice-arena__moves">
                ${MOVES.map(
                  (move) => `
                    <button class="move-btn" data-practice-move="${move.key}">${move.label}</button>
                  `
                ).join('')}
              </div>
              <p class="practice-arena__result">${practiceStatus}<br /><span>${practiceDetail}</span></p>
              <ul class="practice-history">${practiceHistoryHtml}</ul>
            </div>
          </div>
          <div class="lobby-list-wrapper">
            <h3 class="section-subtitle">Aktiivsed lobbyd</h3>
            <div id="lobby-list" class="lobby-list"></div>
          </div>
        </article>
      </div>

      <div class="dashboard-column">
        <article class="card games-card">
          <div class="section-header">
            <h2>Minu mängud</h2>
            <div class="section-actions">
              <button id="start-ai" class="secondary">Harjuta AI vastu</button>
            </div>
          </div>
          <div id="game-list" class="game-list"></div>
          <div id="recent-games" class="game-list game-list--recent"></div>
        </article>

        <article class="card social-card">
          <div class="section-header">
            <h2>Sõprade aktiivsus</h2>
            <button class="link-btn" data-go-view="friends">Ava sõbralist</button>
          </div>
          <div class="friend-preview">${friendPreviewHtml}</div>
        </article>

        <article class="card tournaments-card">
          <div class="section-header">
            <h2>Turniirid</h2>
            <button class="link-btn" data-go-view="tournaments">Kõik turniirid</button>
          </div>
          <div class="tournament-preview-list">${tournamentPreviewHtml}</div>
        </article>

        <article class="card chat-preview-card">
          <div class="section-header">
            <h2>Kogukonna chat</h2>
            <button class="link-btn" data-go-view="chat">Ava chat</button>
          </div>
          <div class="chat-preview">${chatPreviewHtml}</div>
        </article>
      </div>
    </section>
  `;

  const lobbyForm = document.getElementById('create-lobby-form');
  if (lobbyForm) {
    lobbyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const buyIn = Number(lobbyForm.buyIn.value);
      if (!Number.isFinite(buyIn) || buyIn <= 0) {
        showToast('Buy-in peab olema positiivne arv.', true);
        return;
      }
      try {
        await api('/api/lobbies', {
          method: 'POST',
          body: { buyIn },
        });
        lobbyForm.reset();
        showToast('Lobby loodud. Oota vastast!', false);
        fetchDashboard();
      } catch (error) {
        showToast(error.message || 'Lobby loomine ebaõnnestus', true);
      }
    });
  }

  const startAi = document.getElementById('start-ai');
  if (startAi) {
    startAi.addEventListener('click', async () => {
      try {
        const { game } = await api('/api/ai/start', { method: 'POST', body: {} });
        openGame(game.id, game);
        showToast('AI duell alustatud!', false);
      } catch (error) {
        showToast(error.message || 'AI käivitamine ebaõnnestus', true);
      }
    });
  }

  document.querySelectorAll('[data-go-view]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const view = btn.getAttribute('data-go-view');
      if (!view) return;
      state.view = view;
      if (view === 'friends') {
        fetchFriends();
      }
      if (view === 'tournaments') {
        fetchTournaments();
      }
      if (view === 'chat') {
        fetchChat();
      }
      render();
    });
  });

  document.querySelectorAll('[data-open-profile]').forEach((el) => {
    el.addEventListener('click', () => {
      const username = el.getAttribute('data-open-profile');
      if (!username) return;
      state.view = 'profile';
      loadProfile(username);
    });
  });

  document.querySelectorAll('[data-join-tournament]').forEach((el) => {
    el.addEventListener('click', () => {
      const tournamentId = el.getAttribute('data-join-tournament');
      joinTournamentById(tournamentId);
    });
  });

  document.querySelectorAll('[data-practice-move]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const move = btn.getAttribute('data-practice-move');
      handlePracticeMove(move);
    });
  });

  const resetPracticeBtn = document.querySelector('[data-practice-reset]');
  if (resetPracticeBtn) {
    resetPracticeBtn.addEventListener('click', () => {
      resetPracticeGame();
    });
  }

  renderLobbyList();
  renderGameLists(activeGames, recentGames);
}

function renderLobbyList() {
  const container = document.getElementById('lobby-list');
  if (!container) return;
  if (state.lobbies.length === 0) {
    container.innerHTML = '<div class="empty-state">Praegu pole ühtegi avatud lobbyt. Loo uus ja väljakutse sõber!</div>';
    return;
  }

  container.innerHTML = state.lobbies
    .map((lobby) => {
      const isHost = lobby.hostId === state.user.id;
      return `
        <article class="lobby-item">
          <div class="lobby-item__header">
            <div>
              <strong>${lobby.hostUsername}</strong>
              <p class="subtitle">Buy-in: ${lobby.buyIn} π</p>
            </div>
            <div>
              ${isHost ? '<span class="tag">Sinu lobby</span>' : '<span class="tag tag--success">Avatud</span>'}
            </div>
          </div>
          <div class="lobby-item__actions">
            ${isHost ? `<button class="secondary" data-cancel="${lobby.id}">Tühista</button>` : `<button class="primary" data-join="${lobby.id}">Liitu</button>`}
          </div>
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('[data-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lobbyId = btn.getAttribute('data-join');
      try {
        const { game } = await api(`/api/lobbies/${lobbyId}/join`, { method: 'POST', body: {} });
        showToast('Liitusid lobbyga!');
        openGame(game.id, game);
      } catch (error) {
        showToast(error.message || 'Liitumine ebaõnnestus', true);
      }
    });
  });

  container.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lobbyId = btn.getAttribute('data-cancel');
      try {
        await api(`/api/lobbies/${lobbyId}`, { method: 'DELETE' });
        showToast('Lobby tühistatud.');
        fetchDashboard();
      } catch (error) {
        showToast(error.message || 'Tühistamine ebaõnnestus', true);
      }
    });
  });
}

function renderGameLists(activeGames, recentGames) {
  const activeContainer = document.getElementById('game-list');
  const recentContainer = document.getElementById('recent-games');
  if (activeGames.length === 0) {
    activeContainer.innerHTML = '<div class="empty-state">Sul pole aktiivseid mänge. Liitu lobbyga ja alusta duelli!</div>';
  } else {
    activeContainer.innerHTML = activeGames
      .map((game) => {
        const opponent = game.players.find((p) => p.userId !== state.user.id);
        return `
          <article class="game-item">
            <div class="game-item__header">
              <div>
                <strong>${opponent ? opponent.username : 'AI vastane'}</strong>
                <p class="subtitle">Võidud: ${scoreLine(game, state.user.id)}</p>
              </div>
              <span class="tag tag--success">Kestab</span>
            </div>
            <button class="primary" data-open-game="${game.id}">Ava mäng</button>
          </article>
        `;
      })
      .join('');
    activeContainer.querySelectorAll('[data-open-game]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gameId = btn.getAttribute('data-open-game');
        openGame(gameId);
      });
    });
  }

  if (recentGames.length === 0) {
    recentContainer.innerHTML = '';
  } else {
    recentContainer.innerHTML = `
      <h3>Hiljutised tulemused</h3>
      ${recentGames
        .map((game) => {
          const opponent = game.players.find((p) => p.userId !== state.user.id);
          const didWin = game.winnerId === state.user.id;
          return `
            <article class="game-item">
              <div class="game-item__header">
                <div>
                  <strong>${opponent ? opponent.username : 'AI vastane'}</strong>
                  <p class="subtitle">${didWin ? 'Võit' : 'Kaotus'} · Skor: ${scoreLine(game, state.user.id)}</p>
                </div>
                <span class="tag ${didWin ? 'tag--success' : 'tag--danger'}">${didWin ? 'Võit' : 'Kaotus'}</span>
              </div>
              <button class="secondary" data-open-game="${game.id}">Ava</button>
            </article>
          `;
        })
        .join('')}
    `;
    recentContainer.querySelectorAll('[data-open-game]').forEach((btn) => {
      btn.addEventListener('click', () => openGame(btn.getAttribute('data-open-game')));
    });
  }
}

function openGame(gameId, initialGame) {
  state.view = 'game';
  state.currentGameId = gameId;
  if (initialGame) {
    state.currentGame = initialGame;
  }
  render();
  startGamePolling(gameId);
}

function startGamePolling(gameId) {
  if (state.gamePollHandle) {
    clearInterval(state.gamePollHandle);
  }
  fetchGame(gameId);
  state.gamePollHandle = setInterval(() => fetchGame(gameId), 1500);
}

async function fetchGame(gameId) {
  if (!gameId) return;
  try {
    const { game } = await api(`/api/games/${gameId}`);
    state.currentGame = game;
    if (game.status === 'completed') {
      clearInterval(state.gamePollHandle);
      state.gamePollHandle = null;
      showToast('Mäng lõppes!', false);
      fetchDashboard();
    }
    render();
  } catch (error) {
    console.error('Game fetch error', error);
    showToast(error.message || 'Mängu uuendamine ebaõnnestus', true);
  }
}

function renderGame() {
  if (!state.currentGame) {
    appEl.innerHTML = '<section class="card"><p>Laen mängu andmeid...</p></section>';
    return;
  }
  const game = state.currentGame;
  const me = game.players.find((p) => p.userId === state.user.id);
  const opponent = game.players.find((p) => p.userId !== state.user.id);
  const currentRound = game.rounds[game.rounds.length - 1];
  const myMove = currentRound.moves[state.user.id];
  const opponentMove = opponent && currentRound.moves[opponent.userId];
  const secondsLeft = Math.max(0, Math.ceil((currentRound.deadline - Date.now()) / 1000));
  const inProgress = game.status === 'in_progress';

  appEl.innerHTML = `
    <section class="game-view">
      <article class="card">
        <button class="secondary" id="back-to-dashboard">← Tagasi</button>
        <h2>Mäng vs ${opponent ? opponent.username : 'Pi Duel AI'}</h2>
        <p class="subtitle">Best-of-3 · 10s AFK taimer</p>
        <div class="grid-3">
          <div>
            <h3>Sina</h3>
            <p class="balance">${me.wins}</p>
            <p class="subtitle">Võidud</p>
          </div>
          <div>
            <h3>Vastane</h3>
            <p class="balance">${opponent ? opponent.wins : 0}</p>
            <p class="subtitle">Võidud</p>
          </div>
          <div>
            <h3>Taimer</h3>
            <p class="timer">${secondsLeft}s</p>
            <p class="subtitle">Praeguse raundi tähtaeg</p>
          </div>
        </div>
      </article>

      <article class="card">
        <h3>Praegune raund: ${currentRound.round}</h3>
        <div class="move-buttons">
          ${MOVES.map(
            (move) => `
              <button
                class="move-btn"
                data-move="${move.key}"
                ${!inProgress || myMove ? 'disabled' : ''}
              >${move.label}</button>
            `
          ).join('')}
        </div>
        <p class="subtitle">
          Sinu käik: ${myMove ? moveLabel(myMove.choice) : 'pole veel valitud'} · 
          Vastase käik: ${opponentMove ? moveLabel(opponentMove.choice) : 'ootel'}
        </p>
      </article>

      <article class="card">
        <h3>Raundid</h3>
        <div class="round-grid">
          ${game.rounds
            .map((round) => {
              const my = round.moves[state.user.id];
              const opp = opponent ? round.moves[opponent.userId] : null;
              const status = round.winnerId
                ? round.winnerId === state.user.id
                  ? '<span class="tag tag--success">Võitsid</span>'
                  : '<span class="tag tag--danger">Kaotasid</span>'
                : '<span class="tag">Kestab / Viik</span>';
              return `
                <div class="round-card">
                  <div class="lobby-item__header">
                    <strong>Raund ${round.round}</strong>
                    ${status}
                  </div>
                  <p class="subtitle">Sina: ${my ? moveLabel(my.choice) : '—'} · Vastane: ${opp ? moveLabel(opp.choice) : '—'}</p>
                </div>
              `;
            })
            .join('')}
        </div>
      </article>

      ${game.status === 'completed'
        ? `<article class="card">
            <h3>Mäng on lõppenud</h3>
            <p>${game.winnerId === state.user.id ? 'Palju õnne! Võitsid duelli.' : 'Seekord vedas vastasel rohkem.'}</p>
            <button class="primary" id="back-dashboard-finish">Tagasi avalehele</button>
          </article>`
        : ''}
    </section>
  `;

  document.getElementById('back-to-dashboard').addEventListener('click', () => {
    state.view = 'dashboard';
    state.currentGameId = null;
    state.currentGame = null;
    if (state.gamePollHandle) {
      clearInterval(state.gamePollHandle);
      state.gamePollHandle = null;
    }
    render();
  });

  const finishBtn = document.getElementById('back-dashboard-finish');
  if (finishBtn) {
    finishBtn.addEventListener('click', () => {
      state.view = 'dashboard';
      state.currentGameId = null;
      state.currentGame = null;
      render();
    });
  }

  document.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const move = btn.getAttribute('data-move');
      try {
        const { game } = await api(`/api/games/${game.id}/move`, {
          method: 'POST',
          body: { move },
        });
        state.currentGame = game;
        if (game.status === 'completed') {
          clearInterval(state.gamePollHandle);
          state.gamePollHandle = null;
          fetchDashboard();
        }
        render();
      } catch (error) {
        showToast(error.message || 'Käigu saatmine ebaõnnestus', true);
      }
    });
  });
}

function renderProfile() {
  if (state.profileLoading) {
    appEl.innerHTML = '<section class="card"><p>Laen profiili...</p></section>';
    return;
  }
  if (!state.profile) {
    appEl.innerHTML = '<section class="card"><p>Profiili ei leitud.</p></section>';
    return;
  }
  const { user, lobbies, games } = state.profile;
  const netClass = user.stats.netEarnings > 0 ? 'balance--positive' : user.stats.netEarnings < 0 ? 'balance--negative' : '';

  appEl.innerHTML = `
    <section class="grid-2">
      <article class="card">
        <h2>${user.username}</h2>
        <p class="subtitle">Liitus: ${new Date(user.createdAt || Date.now()).toLocaleDateString()}</p>
        <div class="stat-row"><span>Võidud</span><span>${user.stats.wins}</span></div>
        <div class="stat-row"><span>Kaotused</span><span>${user.stats.losses}</span></div>
        <div class="stat-row"><span>Mänge</span><span>${user.stats.gamesPlayed}</span></div>
        <div class="stat-row"><span>Netovõit</span><span class="${netClass}">${user.stats.netEarnings.toFixed(2)} π</span></div>
      </article>
      <article class="card">
        <h2>Aktiivsus</h2>
        <p class="subtitle">Aktiivsed lobbyd: ${lobbies.length}</p>
        <p class="subtitle">Aktiivsed mängud: ${games.filter((g) => g.status === 'in_progress').length}</p>
      </article>
    </section>
    <section class="card">
      <h3>Hiljutised mängud</h3>
      <div class="game-list">
        ${games.length === 0
          ? '<div class="empty-state">Veel pole mänge.</div>'
          : games
              .map((game) => {
                const opponent = game.players.find((p) => p.userId !== user.id);
                const didWin = game.winnerId === user.id;
                return `
                  <article class="game-item">
                    <div class="game-item__header">
                      <div>
                        <strong>${opponent ? opponent.username : 'AI vastane'}</strong>
                        <p class="subtitle">${game.status === 'completed' ? (didWin ? 'Võit' : 'Kaotus') : 'Kestab'} · Skor: ${scoreLine(game, user.id)}</p>
                      </div>
                      <span class="tag ${game.status === 'completed' ? (didWin ? 'tag--success' : 'tag--danger') : ''}">${
                  game.status === 'completed' ? (didWin ? 'Võit' : 'Kaotus') : 'Käimas'
                }</span>
                    </div>
                  </article>
                `;
              })
              .join('')}
      </div>
    </section>
  `;
}

async function loadProfile(username) {
  state.profileLoading = true;
  renderProfile();
  try {
    const profile = await api(`/api/profile/${encodeURIComponent(username)}`);
    state.profile = profile;
  } catch (error) {
    state.profile = null;
    showToast(error.message || 'Profiili laadimine ebaõnnestus', true);
  } finally {
    state.profileLoading = false;
    renderProfile();
  }
}

function renderFriendsView() {
  const friends = state.friends || [];
  const suggestions = state.friendSuggestions || [];
  appEl.innerHTML = `
    <section class="card page-header">
      <h2>Sõbrad ja kogukond</h2>
      <p class="subtitle">Jälgi PancakeSwap vibega duellikaaslasi ja kutsu nad lobby'sse.</p>
    </section>
    <section class="card friends-section">
      <div class="section-header">
        <h3>Minu sõbrad (${friends.length})</h3>
        <form id="add-friend-form" class="inline-form">
          <input type="text" id="friend-username" name="username" placeholder="Lisa kasutajanimi" required minlength="3" maxlength="24" />
          <button type="submit" class="primary">Lisa</button>
        </form>
      </div>
      <div class="friend-grid friend-grid--full">
        ${
          friends.length === 0
            ? '<div class="empty-state">Sul pole veel sõpru. Lisa ChefSizzle või kutsu päris sõbrad duellile!</div>'
            : friends
                .map((friend) => {
                  const statusClass = friend.status === 'online' ? 'friend-card-item--online' : 'friend-card-item--offline';
                  const record = friend.record || { wins: 0, losses: 0 };
                  const lastSeenText = friend.status === 'online' ? 'Online' : `Viimati ${formatRelativeTime(friend.lastSeen)}`;
                  return `
                    <article class="friend-card-item ${statusClass}">
                      <div class="friend-card-item__avatar">${escapeHtml(friend.avatar || '🥞')}</div>
                      <div class="friend-card-item__body">
                        <h4>${escapeHtml(friend.username)}</h4>
                        <p class="subtitle">${escapeHtml(friend.highlight || friend.bio || 'Pi kogukonna liige')}</p>
                        <p class="friend-card-item__meta">${escapeHtml(lastSeenText)}</p>
                      </div>
                      <div class="friend-card-item__stats">
                        <span class="tag">${record.wins}:${record.losses}</span>
                        <button class="link-btn" data-open-profile="${escapeHtml(friend.username)}">Ava profiil</button>
                      </div>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
    <section class="card friends-section">
      <div class="section-header">
        <h3>Soovitused Pancake League'ist</h3>
        <button class="link-btn" id="refresh-suggestions">Värskenda</button>
      </div>
      <div class="friend-grid friend-grid--suggestions">
        ${
          suggestions.length === 0
            ? '<div class="empty-state">Kõik soovitatud tegelased on juba sinu sõbrad.</div>'
            : suggestions
                .map((friend) => {
                  const lastSeenText = friend.status === 'online' ? 'Online' : `Viimati ${formatRelativeTime(friend.lastSeen)}`;
                  return `
                    <article class="friend-suggestion">
                      <div class="friend-suggestion__avatar">${escapeHtml(friend.avatar || '🥞')}</div>
                      <div class="friend-suggestion__body">
                        <strong>${escapeHtml(friend.username)}</strong>
                        <p class="subtitle">${escapeHtml(friend.bio || 'Pi kogukonna liige')}</p>
                        <p class="friend-suggestion__meta">${escapeHtml(lastSeenText)}</p>
                      </div>
                      <button class="secondary" data-add-friend="${escapeHtml(friend.username)}">Lisa sõbraks</button>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;

  const addForm = document.getElementById('add-friend-form');
  if (addForm) {
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = addForm.username.value.trim();
      if (!username) return;
      addFriendByUsername(username);
      addForm.reset();
    });
  }

  const refreshBtn = document.getElementById('refresh-suggestions');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchFriends();
    });
  }

  document.querySelectorAll('[data-add-friend]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const username = btn.getAttribute('data-add-friend');
      addFriendByUsername(username);
    });
  });

  document.querySelectorAll('[data-open-profile]').forEach((el) => {
    el.addEventListener('click', () => {
      const username = el.getAttribute('data-open-profile');
      if (!username) return;
      state.view = 'profile';
      loadProfile(username);
    });
  });
}

function renderTournamentsView() {
  const tournaments = state.tournaments || [];
  appEl.innerHTML = `
    <section class="card page-header">
      <h2>Pi turniirid</h2>
      <p class="subtitle">Osale Pancake League üritustel ja võida siirupiseid auhindu.</p>
    </section>
    <section class="card tournaments-board">
      ${
        tournaments.length === 0
          ? '<div class="empty-state">Hetkel pole ühtegi turniiri avatud.</div>'
      : tournaments
          .map((tournament, index) => {
            const progress = tournament.slots > 0 ? Math.round((tournament.participants / tournament.slots) * 100) : 0;
            const status = tournament.isRegistered ? 'Oled registreerunud' : `${tournament.spotsRemaining} kohta vaba`;
            const toneClass = index % 2 === 0 ? 'badge--primary' : 'badge--accent';
            return `
                  <article class="tournament-card-full ${tournament.isRegistered ? 'is-joined' : ''}">
                    <header class="tournament-card-full__header">
                      <div>
                        <h3>${escapeHtml(tournament.title)}</h3>
                        <p class="subtitle">${escapeHtml(tournament.style)} · ${escapeHtml(tournament.location)}</p>
                      </div>
                      <span class="badge ${toneClass}">${tournament.entryFee} π</span>
                    </header>
                    <div class="tournament-card-full__body">
                      <p>${escapeHtml(formatRelativeTime(tournament.startTime))} · Auhinnafond ${tournament.prizePool} π</p>
                      <div class="tournament-card-full__progress"><span style="width:${Math.min(100, Math.max(progress, 5))}%"></span></div>
                      <p class="subtitle">${tournament.participants}/${tournament.slots} mängijat · ${escapeHtml(status)}</p>
                    </div>
                    <button class="${tournament.isRegistered ? 'secondary' : 'primary'}" data-join-tournament="${escapeHtml(tournament.id)}" ${tournament.isRegistered ? 'disabled' : ''}>
                      ${tournament.isRegistered ? 'Liitunud' : 'Liitu turniiriga'}
                    </button>
                  </article>
                `;
          })
          .join('')
      }
    </section>
  `;

  document.querySelectorAll('[data-join-tournament]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tournamentId = btn.getAttribute('data-join-tournament');
      joinTournamentById(tournamentId);
    });
  });
}

function renderChatView() {
  const messages = state.chatMessages || [];
  const chatBody =
    messages.length === 0
      ? '<div class="empty-state">Alusta PancakeSwap teemalist vestlust ja jaga lobby linke.</div>'
      : messages
          .map((message) => {
            const tone = message.tone || 'chat';
            return `
              <article class="chat-message chat-message--${tone}">
                <span class="chat-message__avatar">${escapeHtml(message.avatar || '🥞')}</span>
                <div class="chat-message__content">
                  <header>
                    <strong>${escapeHtml(message.username)}</strong>
                    <span class="chat-message__time">${escapeHtml(formatRelativeTime(message.createdAt))}</span>
                  </header>
                  <p>${escapeHtml(message.message)}</p>
                </div>
              </article>
            `;
          })
          .join('');

  appEl.innerHTML = `
    <section class="card page-header">
      <h2>Kogukonna chat</h2>
      <p class="subtitle">Jaga strateegiaid, otsi duellikaaslasi ja plaani turniiritiime.</p>
    </section>
    <section class="card chat-board">
      <div class="chat-feed" id="chat-feed">${chatBody}</div>
      <form id="chat-form" class="chat-form">
        <input type="text" id="chat-input" name="message" placeholder="Saada sõnum..." maxlength="280" required value="${escapeHtml(state.chatInput)}" />
        <button type="submit" class="primary">Saada</button>
      </form>
    </section>
  `;

  const feed = document.getElementById('chat-feed');
  if (feed) {
    feed.scrollTop = feed.scrollHeight;
  }

  const chatForm = document.getElementById('chat-form');
  if (chatForm) {
    chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = chatForm.message.value.trim();
      if (!text) return;
      sendChatMessage(text);
    });
    chatForm.message.addEventListener('input', (event) => {
      state.chatInput = event.target.value;
    });
  }
}

function scoreLine(game, userId) {
  if (!game || !Array.isArray(game.players)) {
    return '0 : 0';
  }
  if (!userId) {
    const [first, second] = game.players;
    const firstWins = first ? first.wins : 0;
    const secondWins = second ? second.wins : 0;
    return `${firstWins} : ${secondWins}`;
  }
  const me = game.players.find((player) => player.userId === userId);
  const opponent = game.players.find((player) => player.userId !== userId);
  const myWins = me ? me.wins : 0;
  const opponentWins = opponent ? opponent.wins : 0;
  return `${myWins} : ${opponentWins}`;
}

function moveLabel(move) {
  switch (move) {
    case 'rock':
      return 'Kivi';
    case 'paper':
      return 'Paber';
    case 'scissors':
      return 'Käärid';
    default:
      return move;
  }
}

function createPracticeGame() {
  return {
    playerScore: 0,
    aiScore: 0,
    rounds: [],
    lastOutcome: null,
    streak: 0,
  };
}

function resetPracticeGame() {
  state.practiceGame = createPracticeGame();
  render();
}

function handlePracticeMove(move) {
  if (!move || !WIN_RULES[move]) return;
  const existing = state.practiceGame || createPracticeGame();
  const aiMove = selectPracticeAiMove(existing);
  const result = determinePracticeResult(move, aiMove);
  const entry = { playerMove: move, aiMove, result };
  const history = Array.isArray(existing.rounds) ? [...existing.rounds] : [];
  const updatedRounds = [entry, ...history].slice(0, 6);
  let playerScore = Number(existing.playerScore) || 0;
  let aiScore = Number(existing.aiScore) || 0;
  let streak = Number(existing.streak) || 0;
  if (result === 'win') {
    playerScore += 1;
    streak = streak >= 0 ? streak + 1 : 1;
  } else if (result === 'loss') {
    aiScore += 1;
    streak = 0;
  } else {
    streak = 0;
  }
  state.practiceGame = {
    playerScore,
    aiScore,
    rounds: updatedRounds,
    lastOutcome: entry,
    streak,
  };
  render();
}

function selectPracticeAiMove(practice) {
  const history = [];
  (practice.rounds || []).forEach((round) => {
    if (round && round.playerMove) {
      history.push(round.playerMove);
    }
  });
  if (history.length === 0) {
    return MOVES[Math.floor(Math.random() * MOVES.length)].key;
  }
  const counts = history.reduce((acc, move) => {
    acc[move] = (acc[move] || 0) + 1;
    return acc;
  }, {});
  const moves = Object.keys(WIN_RULES);
  let predicted = moves[0];
  for (const move of moves) {
    if ((counts[move] || 0) > (counts[predicted] || 0)) {
      predicted = move;
    }
  }
  const counter = {
    rock: 'paper',
    paper: 'scissors',
    scissors: 'rock',
  };
  if (Math.random() < 0.2) {
    return MOVES[Math.floor(Math.random() * MOVES.length)].key;
  }
  return counter[predicted] || MOVES[Math.floor(Math.random() * MOVES.length)].key;
}

function determinePracticeResult(playerMove, aiMove) {
  if (playerMove === aiMove) return 'draw';
  return WIN_RULES[playerMove] === aiMove ? 'win' : 'loss';
}

function practiceResultLabel(result) {
  switch (result) {
    case 'win':
      return 'Võit';
    case 'loss':
      return 'Kaotus';
    default:
      return 'Viik';
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Number(timestamp) - Date.now();
  const minutes = Math.max(1, Math.round(Math.abs(diff) / 60000));
  if (diff > 0) {
    if (minutes <= 1) return 'Algab kohe';
    if (minutes < 60) return `Algab ${minutes} min pärast`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Algab ${hours} h pärast`;
    const days = Math.round(hours / 24);
    return `Algab ${days} p pärast`;
  }
  if (minutes <= 1) return 'Just nüüd';
  if (minutes < 60) return `${minutes} min tagasi`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h tagasi`;
  const days = Math.round(hours / 24);
  return `${days} p tagasi`;
}

async function api(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  };
  if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    const message = payload && payload.error ? payload.error : `Viga (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return payload || {};
}

let toastTimeout = null;
function showToast(message, isError = false) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2500);
}
