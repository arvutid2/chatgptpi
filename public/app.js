const state = {
  user: null,
  view: 'dashboard',
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
  profile: null,
  practice: createPracticeState(),
  pollHandle: null,
  gamePollHandle: null,
};

const THEME_KEY = 'pi-duel-theme';
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
    if (action === 'practice-move') {
      const move = target.getAttribute('data-move');
      if (move) {
        playPracticeMove(move);
        render();
      }
    }
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
      if (username) {
        await loadProfile(username);
        state.view = 'profile';
        render();
      }
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
  state.lobbies = [];
  state.games = [];
  state.currentGameId = null;
  state.currentGame = null;
  state.friends = [];
  state.friendSuggestions = [];
  state.tournaments = [];
  state.chatMessages = [];
  state.chatInput = '';
  state.profile = null;
  state.practice = createPracticeState();
  stopPolling();
  stopGamePolling();
  updateNavVisibility();
  updateUserBadge();
}

function setView(view) {
  if (!state.user && view !== 'dashboard') return;
  if (view !== 'game') {
    stopGamePolling();
    state.currentGameId = null;
    state.currentGame = null;
  }
  switch (view) {
    case 'dashboard':
    case 'lobbies':
    case 'friends':
    case 'tournaments':
    case 'chat':
    case 'profile':
      state.view = view;
      if (view === 'profile' && state.user) {
        loadProfile(state.user.username);
      } else if (view !== 'profile') {
        state.profile = null;
      }
      render();
      break;
    default:
      state.view = 'dashboard';
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
      <h2 id="login-title">Logi Pi Duel Arenasse</h2>
      <p class="subtitle">Mock login annab sulle kohe 1000 π saldo ja ligipääsu lobbydele.</p>
      <form id="login-form" class="login-form">
        <label for="username">Kasutajanimi</label>
        <input type="text" id="username" name="username" minlength="3" maxlength="24" required placeholder="nt. syrup-warrior" />
        <button type="submit" class="btn btn-primary">Alusta duelle</button>
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
    showToast(`Tere tulemast, ${user.username}!`);
    startPolling();
    render();
  } catch (error) {
    showToast(error.message || 'Login ebaõnnestus', true);
  }
}

function renderDashboard() {
  if (!state.user) return;
  const stats = state.user.stats || { wins: 0, losses: 0, netEarnings: 0 };
  const activeGames = state.games.filter((game) => game.status === 'in_progress');
  const recentGames = state.games.filter((game) => game.status !== 'in_progress').slice(0, 4);
  const openLobbies = state.lobbies.slice(0, 4);
  const practice = state.practice;
  const practiceHistory = practice.history.slice(0, 5);

  appEl.innerHTML = `
    <section class="card card--gradient">
      <div class="grid grid--three">
        ${renderStat('Saldo', formatPi(state.user.balance))}
        ${renderStat('Võidud', stats.wins || 0)}
        ${renderStat('Kaotused', stats.losses || 0)}
        ${renderStat('Neto', formatPi(stats.netEarnings || 0, true))}
        ${renderStat('Aktiivsed matšid', activeGames.length)}
        ${renderStat('Sõbrad', state.user.friendCount || state.friends.length || 0)}
      </div>
    </section>

    <section class="card">
      <div class="section-title">
        <h3>AI harjutusarena</h3>
        <span>${practice.streak > 1 ? `Võitude jada ${practice.streak}` : 'Testi oma mustreid'}</span>
      </div>
      <div class="practice-arena">
        <div class="practice-card">
          <h4>Vali käik</h4>
          <p class="subtitle">AI reageerib sinu ajalooliste valikute põhjal, proovi teda üle kavaldada.</p>
          <div class="practice-buttons">
            <button type="button" data-action="practice-move" data-move="rock">🪨 Kivi</button>
            <button type="button" data-action="practice-move" data-move="paper">📄 Paber</button>
            <button type="button" data-action="practice-move" data-move="scissors">✂️ Käärid</button>
          </div>
        </div>
        <div class="practice-card">
          <h4>Viimased tulemused</h4>
          <ul class="practice-history">
            ${
              practiceHistory.length === 0
                ? '<li>Alusta harjutamist, et näha tulemusi.</li>'
                : practiceHistory
                    .map((round) => {
                      return `<li><span>${capitalize(round.result)}</span><span>${moveLabel(round.player)} vs ${moveLabel(round.ai)}</span></li>`;
                    })
                    .join('')
            }
          </ul>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="section-title">
        <h3>Avatud lobbid</h3>
        <button class="btn btn-ghost" data-view="lobbies">Vaata kõiki</button>
      </div>
      <div class="lobby-list">
        ${
          openLobbies.length === 0
            ? '<div class="empty-state">Hetkel pole ühtegi avatud lobbyt. Loo enda oma ja kutsu sõber!</div>'
            : openLobbies
                .map((lobby) => {
                  const isYours = lobby.isYours;
                  return `
                    <article class="lobby-card">
                      <div class="lobby-card__meta">
                        <strong>${escapeHtml(lobby.host.username)}</strong>
                        <span class="badge">Buy-in ${formatPi(lobby.stake)}</span>
                      </div>
                      ${
                        isYours
                          ? `<button class="btn btn-ghost" data-action="cancel-lobby" data-lobby="${lobby.id}">Tühista</button>`
                          : `<button class="btn btn-primary" data-action="join-lobby" data-lobby="${lobby.id}">Liitu</button>`
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
        <h3>Hiljutised matšid</h3>
        <span>Vaata täpsemalt profiilivaates</span>
      </div>
      <div class="grid">
        ${
          recentGames.length === 0
            ? '<div class="empty-state">Pole veel ühtegi lõpetatud matši.</div>'
            : recentGames
                .map((game) => renderGameSummary(game))
                .join('')
        }
      </div>
    </section>
  `;
}

function renderLobbyView() {
  if (!state.user) return;
  const hasLobby = state.lobbies.some((lobby) => lobby.isYours);
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Loo uus lobby</h3>
        <span>Buy-in hoitakse escrow's kuni matši lõpuni</span>
      </div>
      <form id="create-lobby-form" class="form-row">
        <div class="form-field">
          <label for="stake">Buy-in π</label>
          <input type="number" id="stake" name="stake" min="1" max="${Math.max(state.user.balance, 1)}" step="1" required ${
            hasLobby ? 'disabled' : ''
          } />
        </div>
        <div class="form-field" style="align-self:flex-end;">
          <button type="submit" class="btn btn-primary" ${hasLobby ? 'disabled' : ''}>Loo lobby</button>
        </div>
      </form>
      ${
        hasLobby
          ? '<p class="subtitle">Sul on juba avatud lobby. Saad selle allpool tühistada.</p>'
          : ''
      }
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Avatud lobbid</h3>
        <span>${state.lobbies.length} aktiivset lobbyt</span>
      </div>
      <div class="lobby-list">
        ${
          state.lobbies.length === 0
            ? '<div class="empty-state">Ühtegi lobbyt pole. Ole esimene ja loo mäng!</div>'
            : state.lobbies
                .map((lobby) => {
                  const isYours = lobby.isYours;
                  return `
                    <article class="lobby-card">
                      <div class="lobby-card__meta">
                        <strong>${escapeHtml(lobby.host.username)}</strong>
                        <span class="badge">Buy-in ${formatPi(lobby.stake)}</span>
                        <span class="badge">Loodud ${timeAgo(lobby.createdAt)}</span>
                      </div>
                      ${
                        isYours
                          ? `<button class="btn btn-ghost" data-action="cancel-lobby" data-lobby="${lobby.id}">Sulge lobby</button>`
                          : `<button class="btn btn-primary" data-action="join-lobby" data-lobby="${lobby.id}">Liitu</button>`
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
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Sõbrad</h3>
        <span>${friends.length} kontakt${friends.length === 1 ? '' : 'i'}</span>
      </div>
      <div class="friend-list">
        ${
          friends.length === 0
            ? '<div class="empty-state">Lisa PancakeSwap legendid sõpradeks ja jälgi nende statistikat.</div>'
            : friends
                .map((friend) => {
                  return `
                    <article class="friend-item">
                      <div>
                        <strong>${escapeHtml(friend.username)}</strong>
                        <span class="friend-status">${statusLabel(friend.status)} · ${friend.record.wins}:${friend.record.losses}</span>
                      </div>
                      <button class="btn btn-ghost" data-action="open-profile" data-username="${friend.username}">Vaata profiili</button>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Lisa sõber</h3>
        <span>Mock kasutajad + pärisduellid</span>
      </div>
      <form id="add-friend-form" class="form-row">
        <div class="form-field">
          <label for="friend-name">Kasutajanimi</label>
          <input type="text" id="friend-name" name="username" minlength="3" maxlength="24" required placeholder="nt. FlipMaster" />
        </div>
        <div class="form-field" style="align-self:flex-end;">
          <button type="submit" class="btn btn-primary">Lisa sõbraks</button>
        </div>
      </form>
      <div class="section-title" style="margin-top:1.5rem;">
        <h3>Soovitused</h3>
        <span>PancakeSwap staarid</span>
      </div>
      <div class="friend-list">
        ${
          suggestions.length === 0
            ? '<div class="empty-state">Kõik legendid on juba su nimekirjas.</div>'
            : suggestions
                .map((friend) => {
                  return `
                    <article class="friend-item">
                      <div>
                        <strong>${escapeHtml(friend.username)}</strong>
                        <span class="friend-status">${statusLabel(friend.status)} · ${friend.record.wins}:${friend.record.losses}</span>
                      </div>
                      <button class="btn btn-ghost" data-action="open-profile" data-username="${friend.username}">Vaata profiili</button>
                    </article>
                  `;
                })
                .join('')
        }
      </div>
    </section>
  `;
}

function renderTournamentsView() {
  const tournaments = state.tournaments || [];
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Turniirikalender</h3>
        <span>Pi kogukonna spotlight</span>
      </div>
      <div class="grid">
        ${
          tournaments.length === 0
            ? '<div class="empty-state">Turniire pole veel kuvatud.</div>'
            : tournaments
                .map((tournament) => {
                  return `
                    <article class="game-summary">
                      <div class="game-summary__header">
                        <div class="game-summary__meta">
                          <strong>${escapeHtml(tournament.title)}</strong>
                          <span class="badge">${escapeHtml(tournament.style)}</span>
                        </div>
                        <span class="badge badge--accent">${formatPi(tournament.entryFee)} buy-in</span>
                      </div>
                      <p class="subtitle">${escapeHtml(tournament.location)}</p>
                      <p class="subtitle">Algus ${formatDate(tournament.startTime)} · ${tournament.participants}/${tournament.slots} osalejat</p>
                      <button class="btn ${tournament.isRegistered ? 'btn-ghost' : 'btn-primary'}" data-action="join-tournament" data-tournament="${tournament.id}" ${
                        tournament.isRegistered ? 'disabled' : ''
                      }>${tournament.isRegistered ? 'Liitunud' : 'Liitu'}</button>
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
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>Kogukonna chat</h3>
        <span>Mock vestlus PancakeSwap vibe'iga</span>
      </div>
      <div class="chat-messages">
        ${
          messages.length === 0
            ? '<div class="empty-state">Alusta vestlust ja kutsu kogukond duellile!</div>'
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
        <input type="text" name="message" placeholder="Kirjuta sõnum..." maxlength="240" required value="${escapeHtml(state.chatInput)}" />
        <button type="submit" class="btn btn-primary">Saada</button>
      </form>
    </section>
  `;
}

function renderProfileView() {
  const profile = state.profile;
  if (!profile || !profile.user) {
    appEl.innerHTML = '<div class="card"><div class="empty-state">Profiili laadimine...</div></div>';
    return;
  }
  const { user, games, friends } = profile;
  const stats = user.stats || { wins: 0, losses: 0 };
  appEl.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h3>${escapeHtml(user.username)}</h3>
        <span>${escapeHtml(user.tagline || 'Pi Duelist')}</span>
      </div>
      <p class="subtitle">${escapeHtml(user.bio || 'Mock profiil Pi Duel Arena maailmast.')}</p>
      <div class="grid grid--three" style="margin-top:1.2rem;">
        ${renderStat('Saldo', formatPi(user.balance))}
        ${renderStat('Võidud', stats.wins || 0)}
        ${renderStat('Kaotused', stats.losses || 0)}
      </div>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Viimased mängud</h3>
        <span>${games.length} kirjet</span>
      </div>
      <div class="grid">
        ${
          games.length === 0
            ? '<div class="empty-state">Pole veel ühtegi matši.</div>'
            : games
                .slice(0, 6)
                .map((game) => renderGameSummary(game))
                .join('')
        }
      </div>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Sõbrad</h3>
        <span>${friends.length} kontakt${friends.length === 1 ? '' : 'i'}</span>
      </div>
      <div class="friend-list">
        ${
          friends.length === 0
            ? '<div class="empty-state">See kasutaja pole veel kedagi lisanud.</div>'
            : friends
                .map((friend) => `<article class="friend-item"><div><strong>${escapeHtml(friend.username)}</strong><span class="friend-status">${statusLabel(friend.status)}</span></div></article>`)
                .join('')
        }
      </div>
    </section>
  `;
}

function renderGameView() {
  const game = state.currentGame;
  if (!game) {
    appEl.innerHTML = '<div class="card"><div class="empty-state">Mängu laadimine...</div></div>';
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
        <h3>${escapeHtml(you?.username || 'Sina')} vs ${escapeHtml(opponent?.username || 'Vastane')}</h3>
        <span>${game.status === 'completed' ? resultLabel(game) : 'Best-of-3 · 10s timer'}</span>
      </div>
      <div class="game-layout">
        <article class="player-card">
          <h4>${escapeHtml(you?.username || 'Sina')}</h4>
          <p class="subtitle">Skoor ${you?.score ?? 0}</p>
          <div class="practice-buttons">
            <button class="btn btn-primary" data-action="submit-move" data-move="rock" ${game.canMove ? '' : 'disabled'}>🪨 Kivi</button>
            <button class="btn btn-primary" data-action="submit-move" data-move="paper" ${game.canMove ? '' : 'disabled'}>📄 Paber</button>
            <button class="btn btn-primary" data-action="submit-move" data-move="scissors" ${game.canMove ? '' : 'disabled'}>✂️ Käärid</button>
          </div>
        </article>
        <article class="player-card">
          <h4>${escapeHtml(opponent?.username || 'Vastane')}</h4>
          <p class="subtitle">Skoor ${opponent?.score ?? 0}</p>
          <p class="subtitle">${game.status === 'completed' ? resultLabel(game) : 'Ootame käiku...'}</p>
        </article>
        <article class="player-card">
          <h4>Voorud</h4>
          <div class="round-log">
            ${
              rounds.length === 0
                ? '<div class="empty-state">Vooru info ilmub kohe, kui mõlemad on käigu teinud.</div>'
                : rounds
                    .map((round) => {
                      const youMoveRaw = you ? round.moves[you.username] : null;
                      const oppMoveRaw = opponent ? round.moves[opponent.username] : null;
                      const youMove = youMoveRaw ? moveLabel(youMoveRaw) : '—';
                      const oppMove = oppMoveRaw ? moveLabel(oppMoveRaw) : '❔';
                      const result = round.result ? roundResultLabel(round.result, you?.id) : 'Ootel';
                      return `<div class="round-log__item"><span>R${round.number}: ${result}</span><span>${youMove} · ${oppMove}</span></div>`;
                    })
                    .join('')
            }
          </div>
        </article>
      </div>
      <div class="section-title" style="margin-top:1.4rem;">
        <span class="timer">${game.status === 'completed' ? 'Matš lõppenud' : remaining !== null ? `${remaining}s` : ''}</span>
        <button class="btn btn-ghost" data-view="dashboard">Tagasi avalehele</button>
      </div>
    </section>
  `;
}

function renderStat(label, value) {
  return `<div class="stat-pill"><h4>${label}</h4><strong>${value}</strong></div>`;
}

function renderGameSummary(game) {
  const opponent = game.opponent || { username: '—' };
  const badge = game.result === 'win' ? 'badge badge--accent' : 'badge';
  const status = game.status === 'in_progress' ? 'Käimas' : game.result === 'win' ? 'Võit' : game.result === 'loss' ? 'Kaotus' : 'Lõppenud';
  return `
    <article class="game-summary">
      <div class="game-summary__header">
        <div class="game-summary__meta">
          <strong>${escapeHtml(opponent.username)}</strong>
          <span class="score-pill">${game.youScore ?? 0} : ${game.opponentScore ?? 0}</span>
        </div>
        <span class="${badge}">${status}</span>
      </div>
      <p class="subtitle">Buy-in ${formatPi(game.stake)} · Pot ${formatPi(game.pot)}</p>
      <button class="btn btn-ghost" data-action="open-game" data-game="${game.id}">Ava mäng</button>
    </article>
  `;
}

async function handleCreateLobby(form) {
  const stakeValue = Number(form.stake.value);
  if (Number.isNaN(stakeValue) || stakeValue <= 0) return;
  try {
    await api('/api/lobbies', {
      method: 'POST',
      body: { stake: stakeValue },
    });
    showToast('Lobby loodud!');
    form.reset();
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Lobby loomine ebaõnnestus', true);
  }
}

async function joinLobby(lobbyId) {
  try {
    const { game } = await api(`/api/lobbies/${lobbyId}/join`, { method: 'POST' });
    showToast('Liitusid lobbyga!');
    await refreshDashboard();
    if (game && game.id) {
      await openGame(game.id);
    }
  } catch (error) {
    showToast(error.message || 'Liitumine ebaõnnestus', true);
  }
}

async function cancelLobby(lobbyId) {
  try {
    await api(`/api/lobbies/${lobbyId}`, { method: 'DELETE' });
    showToast('Lobby suletud.');
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Lobby sulgemine ebaõnnestus', true);
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
    showToast(error.message || 'Mängu avamine ebaõnnestus', true);
  }
}

async function submitMove(gameId, move) {
  try {
    const { game } = await api(`/api/games/${gameId}/move`, {
      method: 'POST',
      body: { move },
    });
    state.currentGame = game;
    showToast('Käik registreeritud!');
    render();
  } catch (error) {
    showToast(error.message || 'Käigu saatmine ebaõnnestus', true);
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
    await api(`/api/tournaments/${id}/join`, { method: 'POST' });
    showToast('Liitusid turniiriga!');
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Turniiriga liitumine ebaõnnestus', true);
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
    form.reset();
    render();
  } catch (error) {
    showToast(error.message || 'Sõnumi saatmine ebaõnnestus', true);
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
    form.reset();
    showToast(`${username} lisatud sõbraks!`);
    render();
  } catch (error) {
    showToast(error.message || 'Sõbra lisamine ebaõnnestus', true);
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
    showToast(error.message || 'Profiili ei leitud', true);
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

function playPracticeMove(move) {
  const practice = state.practice;
  const aiMove = chooseAiMove(practice);
  const result = decideRound(move, aiMove);
  practice.history.unshift({ player: move, ai: aiMove, result });
  if (practice.history.length > 10) {
    practice.history.splice(10);
  }
  practice.playerCounts[move] += 1;
  if (result === 'win') {
    practice.wins += 1;
    practice.streak += 1;
  } else if (result === 'loss') {
    practice.losses += 1;
    practice.streak = 0;
  } else {
    practice.draws += 1;
  }
}

function createPracticeState() {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    history: [],
    playerCounts: {
      rock: 0,
      paper: 0,
      scissors: 0,
    },
  };
}

function chooseAiMove(practice) {
  const counts = practice.playerCounts;
  const total = counts.rock + counts.paper + counts.scissors;
  if (total === 0) {
    return randomMove();
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [mostPlayed, amount] = sorted[0];
  if (amount === 0) {
    return randomMove();
  }
  // 70% vastu kõige sagedasemale, 30% random
  if (Math.random() < 0.7) {
    return counterMove(mostPlayed);
  }
  return randomMove();
}

function randomMove() {
  const options = ['rock', 'paper', 'scissors'];
  return options[Math.floor(Math.random() * options.length)];
}

function counterMove(move) {
  switch (move) {
    case 'rock':
      return 'paper';
    case 'paper':
      return 'scissors';
    default:
      return 'rock';
  }
}

function decideRound(player, ai) {
  if (player === ai) return 'draw';
  if (
    (player === 'rock' && ai === 'scissors') ||
    (player === 'paper' && ai === 'rock') ||
    (player === 'scissors' && ai === 'paper')
  ) {
    return 'win';
  }
  return 'loss';
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
    if (view === state.view) {
      button.classList.add('nav-link--active');
    } else {
      button.classList.remove('nav-link--active');
    }
  });
}

function updateUserBadge() {
  if (!userBadge) return;
  if (!state.user) {
    userBadge.innerHTML = '<span class="badge">Pole sisse logitud</span>';
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
    const error = new Error(payload.error || `Viga (${response.status})`);
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
      return 'Kivi';
    case 'paper':
      return 'Paber';
    case 'scissors':
      return 'Käärid';
    default:
      return '—';
  }
}

function roundResultLabel(result, viewerId) {
  if (!result) return 'Ootel';
  if (!result.winnerId) {
    return result.reason === 'timeout' ? 'AFK' : 'Viik';
  }
  return result.winnerId === viewerId ? 'Võit' : 'Kaotus';
}

function statusLabel(status) {
  switch (status) {
    case 'online':
      return 'Online';
    case 'in_game':
      return 'Mängib';
    default:
      return 'Offline';
  }
}

function resultLabel(game) {
  if (!game) return '';
  if (game.status !== 'completed') return 'Mäng käib';
  if (game.winnerId === state.user.id) {
    return 'Võit!';
  }
  if (game.winnerId) {
    return 'Kaotus';
  }
  return 'Matš lõpetatud';
}

function formatPi(value, includeSign = false) {
  const amount = Number(value) || 0;
  const formatted = `${amount.toFixed(2)} π`;
  if (!includeSign) return formatted;
  if (amount > 0) return `+${formatted}`;
  return formatted;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('et-EE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(timestamp) {
  const diff = Date.now() - Number(timestamp || 0);
  if (diff < 0) return 'just nüüd';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s tagasi`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m tagasi`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h tagasi`;
  const days = Math.floor(hours / 24);
  return `${days}p tagasi`;
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

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
