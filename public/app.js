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
};

const MOVES = [
  { key: 'rock', label: 'Kivi 🪨' },
  { key: 'paper', label: 'Paber 📄' },
  { key: 'scissors', label: 'Käärid ✂️' },
];

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');
const navDashboard = document.getElementById('nav-dashboard');
const navProfile = document.getElementById('nav-profile');
const navLogout = document.getElementById('nav-logout');
const navBar = document.querySelector('.sidebar__nav');

navDashboard.addEventListener('click', () => {
  if (!state.user) return;
  state.view = 'dashboard';
  state.profile = null;
  render();
});

navProfile.addEventListener('click', () => {
  if (!state.user) return;
  state.view = 'profile';
  loadProfile(state.user.username);
});

navLogout.addEventListener('click', async () => {
  if (!state.user) return;
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout failed', error);
  }
  stopPolling();
  resetState();
  render();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else if (state.user) {
    startPolling();
  }
});

init();

async function init() {
  await refreshSession();
  if (state.user) {
    startPolling();
  }
  render();
}

function resetState() {
  state.user = null;
  state.lobbies = [];
  state.games = [];
  state.view = 'dashboard';
  state.currentGameId = null;
  state.currentGame = null;
  state.profile = null;
  updateNavVisibility();
}

function startPolling() {
  stopPolling();
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
  try {
    const [sessionRes, lobbiesRes, gamesRes] = await Promise.all([
      api('/api/auth/session'),
      api('/api/lobbies'),
      api('/api/games'),
    ]);
    state.user = sessionRes.user;
    state.lobbies = lobbiesRes.lobbies || [];
    state.games = gamesRes.games || [];
    updateNavVisibility();
    if (state.view === 'profile' && state.profile) {
      loadProfile(state.profile.user.username);
    }
    render();
  } catch (error) {
    console.error('Failed to refresh dashboard', error);
    if (error.status === 401) {
      stopPolling();
      resetState();
      render();
    }
  }
}

function updateNavVisibility() {
  if (!navBar) return;
  if (state.user) {
    navBar.classList.remove('hidden');
    navLogout.disabled = false;
    navProfile.disabled = false;
    navDashboard.disabled = false;
  } else {
    navBar.classList.add('hidden');
    navLogout.disabled = true;
    navProfile.disabled = true;
    navDashboard.disabled = true;
  }
  updateNavActive();
}

function updateNavActive() {
  if (!navBar) return;
  const activeView = state.view === 'game' ? 'dashboard' : state.view;
  const buttons = navBar.querySelectorAll('[data-view]');
  buttons.forEach((btn) => {
    const view = btn.getAttribute('data-view');
    if (state.user && view === activeView) {
      btn.classList.add('sidebar__link--active');
    } else {
      btn.classList.remove('sidebar__link--active');
    }
  });
}

function render() {
  if (!state.user) {
    renderLogin();
    updateNavActive();
    return;
  }
  switch (state.view) {
    case 'game':
      renderGame();
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

  appEl.innerHTML = `
    <section class="grid-2">
      <article class="card">
        <h2>Minu konto</h2>
        <p class="subtitle">Mock Pi saldo: <strong class="balance">${state.user.balance.toFixed(2)} π</strong></p>
        <div class="stat-row"><span>Võidud</span><span>${stats.wins}</span></div>
        <div class="stat-row"><span>Kaotused</span><span>${stats.losses}</span></div>
        <div class="stat-row"><span>Mängud kokku</span><span>${stats.gamesPlayed}</span></div>
        <div class="stat-row"><span>Netovõit</span><span class="${netClass}">${stats.netEarnings.toFixed(2)} π</span></div>
      </article>
      <article class="card">
        <h2>Loo uus lobby</h2>
        <p class="subtitle">Määra buy-in ja kutsu vastane duellile.</p>
        <form id="create-lobby-form" class="lobby-form">
          <label for="buy-in">Buy-in (π)</label>
          <input type="number" id="buy-in" name="buyIn" min="1" step="1" required placeholder="nt. 25" />
          <button type="submit" class="primary">Loo lobby</button>
        </form>
        ${state.user.lobbyId ? '<p class="subtitle">Sul on aktiivne lobby – vaata allpool.</p>' : ''}
      </article>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>Aktiivsed lobbyd</h2>
        <span class="tag">Escrow 90/10</span>
      </div>
      <div id="lobby-list" class="lobby-list"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>Minu mängud</h2>
        <button id="start-ai" class="secondary">Harjuta AI vastu</button>
      </div>
      <div id="game-list" class="game-list"></div>
      <div id="recent-games" class="game-list"></div>
    </section>
  `;

  const lobbyForm = document.getElementById('create-lobby-form');
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

  document.getElementById('start-ai').addEventListener('click', async () => {
    try {
      const { game } = await api('/api/ai/start', { method: 'POST', body: {} });
      openGame(game.id, game);
      showToast('AI duell alustatud!', false);
    } catch (error) {
      showToast(error.message || 'AI käivitamine ebaõnnestus', true);
    }
  });

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
