const { randomUUID } = require('crypto');

const MOVE_VALUES = ['rock', 'paper', 'scissors'];
const WIN_MAP = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

const ROUND_TIME_LIMIT_MS = 10000;
const MAX_ROUND_WINS = 2;
const SYSTEM_FEE_RATIO = 0.1;

class GameStore {
  constructor() {
    this.users = new Map();
    this.usersByName = new Map();
    this.sessions = new Map();
    this.lobbies = new Map();
    this.games = new Map();
    this.houseEarnings = 0;
  }

  _ensureUsername(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Username is required.');
    }
    const trimmed = username.trim();
    if (!trimmed) {
      throw new Error('Username cannot be empty.');
    }
    if (trimmed.length > 24) {
      throw new Error('Username is too long.');
    }
    return trimmed;
  }

  _createUser(username) {
    const now = Date.now();
    const user = {
      id: randomUUID(),
      username,
      balance: 1000,
      stats: {
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        netEarnings: 0,
        totalEarned: 0,
        totalWagered: 0,
      },
      lobbyId: null,
      activeGames: new Set(),
      completedGames: [],
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    this.usersByName.set(username.toLowerCase(), user);
    return user;
  }

  _getUserByUsername(username) {
    return this.usersByName.get(username.toLowerCase()) || null;
  }

  createSession(username) {
    const cleanName = this._ensureUsername(username);
    let user = this._getUserByUsername(cleanName);
    if (!user) {
      user = this._createUser(cleanName);
    } else {
      user.updatedAt = Date.now();
    }
    const token = randomUUID();
    this.sessions.set(token, { token, userId: user.id, createdAt: Date.now() });
    return { token, user: this._publicUser(user) };
  }

  endSession(token) {
    this.sessions.delete(token);
  }

  getUserBySession(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    const user = this.users.get(session.userId);
    if (!user) {
      this.sessions.delete(token);
      return null;
    }
    return this._publicUser(user);
  }

  _publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      balance: user.balance,
      lobbyId: user.lobbyId,
      activeGames: Array.from(user.activeGames),
      stats: { ...user.stats },
      completedGames: user.completedGames.slice(-10),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  requireUser(token) {
    return this._requireUserBySession(token);
  }

  getProfile(username) {
    const clean = this._ensureUsername(username);
    const user = this._getUserByUsername(clean);
    if (!user) return null;
    this._sweepAbandonedLobbies();
    const lobbies = this.listUserLobbies(user.id);
    const games = this.listUserGames(user.id).slice(0, 10);
    return {
      user: this._publicUser(user),
      lobbies,
      games,
    };
  }

  _requireUserBySession(token) {
    const session = this.sessions.get(token);
    if (!session) {
      throw new Error('Not authenticated.');
    }
    const user = this.users.get(session.userId);
    if (!user) {
      this.sessions.delete(token);
      throw new Error('User account missing.');
    }
    return user;
  }

  listLobbies() {
    this._sweepAbandonedLobbies();
    return Array.from(this.lobbies.values())
      .filter((lobby) => lobby.status === 'open')
      .map((lobby) => this._publicLobby(lobby));
  }

  listUserLobbies(userId) {
    this._sweepAbandonedLobbies();
    return Array.from(this.lobbies.values())
      .filter((lobby) => lobby.hostId === userId)
      .map((lobby) => this._publicLobby(lobby));
  }

  listUserGames(userId) {
    const result = [];
    for (const game of this.games.values()) {
      if (game.players.some((p) => p.userId === userId)) {
        this._evaluateDeadlines(game);
        result.push(this._publicGame(game));
      }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getGame(gameId, { hydrate = true } = {}) {
    const game = this.games.get(gameId);
    if (!game) return null;
    if (hydrate) {
      this._evaluateDeadlines(game);
    }
    return this._publicGame(game);
  }

  _publicLobby(lobby) {
    return {
      id: lobby.id,
      hostId: lobby.hostId,
      hostUsername: lobby.hostUsername,
      buyIn: lobby.buyIn,
      status: lobby.status,
      createdAt: lobby.createdAt,
      opponentId: lobby.opponentId || null,
      gameId: lobby.gameId || null,
    };
  }

  _publicGame(game) {
    return {
      id: game.id,
      lobbyId: game.lobbyId || null,
      mode: game.mode,
      status: game.status,
      players: game.players.map((player) => ({
        userId: player.userId,
        username: player.username,
        wins: player.wins,
        isAI: player.isAI || false,
      })),
      rounds: game.rounds.map((round) => ({
        round: round.round,
        moves: round.moves,
        winnerId: round.winnerId || null,
        deadline: round.deadline,
      })),
      currentRound: game.currentRound,
      winnerId: game.winnerId || null,
      buyIn: game.buyIn,
      pot: game.pot,
      systemFee: game.systemFee,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      completedAt: game.completedAt || null,
      resultReason: game.resultReason || null,
    };
  }

  createLobby(token, { buyIn }) {
    const user = this._requireUserBySession(token);
    const amount = Number(buyIn);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Buy-in must be a positive number.');
    }
    if (user.balance < amount) {
      throw new Error('Insufficient balance for buy-in.');
    }
    if (user.activeGames.size > 0) {
      throw new Error('Finish your active game before creating a new lobby.');
    }
    if (user.lobbyId) {
      const existing = this.lobbies.get(user.lobbyId);
      if (existing && existing.status === 'open') {
        throw new Error('You already have an active lobby.');
      }
    }
    const now = Date.now();
    const lobby = {
      id: randomUUID(),
      hostId: user.id,
      hostUsername: user.username,
      buyIn: amount,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      opponentId: null,
      gameId: null,
    };
    this.lobbies.set(lobby.id, lobby);
    user.lobbyId = lobby.id;
    user.updatedAt = now;
    return this._publicLobby(lobby);
  }

  cancelLobby(token, lobbyId) {
    const user = this._requireUserBySession(token);
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      throw new Error('Lobby not found.');
    }
    if (lobby.hostId !== user.id) {
      throw new Error('Only the host can cancel the lobby.');
    }
    if (lobby.status !== 'open') {
      throw new Error('Only open lobbies can be cancelled.');
    }
    this.lobbies.delete(lobby.id);
    if (user.lobbyId === lobby.id) {
      user.lobbyId = null;
    }
    user.updatedAt = Date.now();
    return { success: true };
  }

  joinLobby(token, lobbyId) {
    const user = this._requireUserBySession(token);
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      throw new Error('Lobby not found.');
    }
    if (lobby.status !== 'open') {
      throw new Error('Lobby is not open.');
    }
    if (lobby.hostId === user.id) {
      throw new Error('You cannot join your own lobby.');
    }
    if (user.balance < lobby.buyIn) {
      throw new Error('Insufficient balance.');
    }
    if (user.activeGames.size > 0) {
      throw new Error('You already have a running game.');
    }
    const host = this.users.get(lobby.hostId);
    if (!host) {
      throw new Error('Lobby host not found.');
    }
    if (host.balance < lobby.buyIn) {
      throw new Error('Host cannot cover the buy-in.');
    }
    const game = this._startPvpGame(lobby, host, user);
    return this._publicGame(game);
  }

  startAiGame(token, { difficulty = 'normal' } = {}) {
    const user = this._requireUserBySession(token);
    if (user.activeGames.size > 0) {
      throw new Error('Finish your active game before starting AI duel.');
    }
    const game = this._startAiGame(user, difficulty);
    return this._publicGame(game);
  }

  _startPvpGame(lobby, host, opponent) {
    const now = Date.now();
    lobby.status = 'in_game';
    lobby.opponentId = opponent.id;
    host.lobbyId = null;
    lobby.updatedAt = now;

    const pot = lobby.buyIn * 2;
    const systemFee = Math.round(pot * SYSTEM_FEE_RATIO);

    host.balance -= lobby.buyIn;
    opponent.balance -= lobby.buyIn;
    host.stats.totalWagered += lobby.buyIn;
    opponent.stats.totalWagered += lobby.buyIn;

    const game = {
      id: randomUUID(),
      lobbyId: lobby.id,
      mode: 'pvp',
      status: 'in_progress',
      buyIn: lobby.buyIn,
      pot,
      systemFee,
      players: [
        { userId: host.id, username: host.username, wins: 0, isAI: false },
        { userId: opponent.id, username: opponent.username, wins: 0, isAI: false },
      ],
      currentRound: 1,
      rounds: [this._createRound(1)],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      winnerId: null,
      resultReason: null,
    };
    this.games.set(game.id, game);
    lobby.gameId = game.id;

    host.activeGames.add(game.id);
    opponent.activeGames.add(game.id);
    host.updatedAt = now;
    opponent.updatedAt = now;
    return game;
  }

  _startAiGame(user, difficulty) {
    const now = Date.now();
    const buyIn = 0;
    const pot = 0;
    const systemFee = 0;
    const aiPlayer = {
      userId: 'ai-engine',
      username: 'Pi Duel AI',
      wins: 0,
      isAI: true,
      difficulty,
    };
    const game = {
      id: randomUUID(),
      lobbyId: null,
      mode: 'ai',
      status: 'in_progress',
      buyIn,
      pot,
      systemFee,
      players: [
        { userId: user.id, username: user.username, wins: 0, isAI: false },
        aiPlayer,
      ],
      currentRound: 1,
      rounds: [this._createRound(1)],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      winnerId: null,
      resultReason: null,
    };
    this.games.set(game.id, game);
    user.activeGames.add(game.id);
    user.updatedAt = now;
    return game;
  }

  _createRound(roundNumber) {
    const now = Date.now();
    return {
      round: roundNumber,
      moves: {},
      winnerId: null,
      startedAt: now,
      deadline: now + ROUND_TIME_LIMIT_MS,
    };
  }

  submitMove(token, gameId, moveChoice) {
    const user = this._requireUserBySession(token);
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found.');
    }
    if (game.status !== 'in_progress') {
      throw new Error('Game is not active.');
    }
    if (!MOVE_VALUES.includes(moveChoice)) {
      throw new Error('Invalid move.');
    }
    const player = game.players.find((p) => p.userId === user.id);
    if (!player) {
      throw new Error('You are not part of this game.');
    }

    this._evaluateDeadlines(game);
    if (game.status !== 'in_progress') {
      throw new Error('Game is not active.');
    }

    let round = game.rounds[game.rounds.length - 1];

    if (round.moves[user.id]) {
      throw new Error('Move already submitted for this round.');
    }

    const now = Date.now();
    if (now > round.deadline) {
      this._evaluateDeadlines(game);
      if (game.status !== 'in_progress') {
        throw new Error('Round resolved by timeout.');
      }
      round = game.rounds[game.rounds.length - 1];
      if (round.moves[user.id]) {
        throw new Error('Move already submitted for this round.');
      }
      if (now > round.deadline) {
        throw new Error('Round deadline has passed.');
      }
    }

    const isFirstMove = Object.keys(round.moves).length === 0;
    round.moves[user.id] = { choice: moveChoice, madeAt: now };
    if (isFirstMove) {
      round.deadline = now + ROUND_TIME_LIMIT_MS;
    }

    game.updatedAt = now;

    if (game.mode === 'ai') {
      this._handleAiTurn(game, round, player);
    }

    this._evaluateRound(game, round);
    return this._publicGame(game);
  }

  _handleAiTurn(game, round, humanPlayer) {
    const ai = game.players.find((p) => p.isAI);
    if (!ai) return;
    if (round.moves[ai.userId]) return;
    const choice = this._generateAiMove(game, ai, humanPlayer);
    round.moves[ai.userId] = { choice, madeAt: Date.now() };
  }

  _generateAiMove(game, aiPlayer, humanPlayer) {
    const history = [];
    for (const round of game.rounds) {
      const move = round.moves[humanPlayer.userId];
      if (move) {
        history.push(move.choice);
      }
    }
    if (history.length === 0 || aiPlayer.difficulty === 'random') {
      return MOVE_VALUES[Math.floor(Math.random() * MOVE_VALUES.length)];
    }
    const counts = history.reduce(
      (acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
      },
      {}
    );
    let predicted = 'rock';
    let maxCount = -1;
    for (const move of MOVE_VALUES) {
      const count = counts[move] || 0;
      if (count > maxCount) {
        predicted = move;
        maxCount = count;
      }
    }
    const counter = {
      rock: 'paper',
      paper: 'scissors',
      scissors: 'rock',
    };
    return counter[predicted];
  }

  _evaluateRound(game, round) {
    this._evaluateDeadlines(game);
    if (!round.moves) return;
    const players = game.players.map((p) => p.userId);
    const [p1, p2] = players;
    if (!round.moves[p1] || !round.moves[p2]) {
      return;
    }
    const move1 = round.moves[p1].choice;
    const move2 = round.moves[p2].choice;
    if (move1 === move2) {
      round.winnerId = null;
      this._startNextRound(game, 'Draw');
      return;
    }
    const winnerId = WIN_MAP[move1] === move2 ? p1 : p2;
    round.winnerId = winnerId;
    this._registerRoundWin(game, winnerId);
  }

  _registerRoundWin(game, winnerId) {
    const player = game.players.find((p) => p.userId === winnerId);
    if (player) {
      player.wins += 1;
    }
    if (player && player.wins >= MAX_ROUND_WINS) {
      this._finishGame(game, winnerId, 'Victory');
    } else {
      this._startNextRound(game, 'Round won');
    }
  }

  _startNextRound(game, reason) {
    if (game.status !== 'in_progress') return;
    const next = this._createRound(game.rounds.length + 1);
    game.rounds.push(next);
    game.currentRound = next.round;
    game.resultReason = reason;
    game.updatedAt = Date.now();
  }

  _finishGame(game, winnerId, reason) {
    if (game.status !== 'in_progress') return;
    const now = Date.now();
    const loser = game.players.find((p) => p.userId !== winnerId);
    const winner = this.users.get(winnerId);
    const loserUser = loser && this.users.get(loser.userId);
    const systemFee = Math.round(game.pot * SYSTEM_FEE_RATIO);
    const payout = Math.max(game.pot - systemFee, 0);

    if (winner) {
      winner.balance += payout;
      winner.stats.wins += 1;
      winner.stats.gamesPlayed += 1;
      if (game.mode === 'pvp') {
        winner.stats.netEarnings += payout - game.buyIn;
        winner.stats.totalEarned += payout;
      }
      winner.activeGames.delete(game.id);
      winner.completedGames.push({
        gameId: game.id,
        result: 'win',
        opponent: loser ? loser.username : 'Pi Duel AI',
        completedAt: now,
        mode: game.mode,
      });
      winner.updatedAt = now;
    }

    if (loserUser) {
      loserUser.stats.losses += 1;
      loserUser.stats.gamesPlayed += 1;
      if (game.mode === 'pvp') {
        loserUser.stats.netEarnings -= game.buyIn;
      }
      loserUser.activeGames.delete(game.id);
      loserUser.completedGames.push({
        gameId: game.id,
        result: 'loss',
        opponent: winner ? winner.username : 'Pi Duel AI',
        completedAt: now,
        mode: game.mode,
      });
      loserUser.updatedAt = now;
    }

    if (game.lobbyId) {
      const lobby = this.lobbies.get(game.lobbyId);
      if (lobby) {
        lobby.status = 'completed';
        lobby.updatedAt = now;
      }
    }

    if (game.mode === 'pvp') {
      this.houseEarnings += systemFee;
    }

    game.status = 'completed';
    game.winnerId = winnerId;
    game.completedAt = now;
    game.updatedAt = now;
    game.resultReason = reason;
  }

  _evaluateDeadlines(game) {
    if (game.status !== 'in_progress') return;
    const round = game.rounds[game.rounds.length - 1];
    const now = Date.now();
    if (now <= round.deadline) {
      return;
    }
    const players = game.players.map((p) => p.userId);
    const missing = players.filter((id) => !round.moves[id]);
    if (missing.length === 0) {
      return;
    }
    const completed = players.filter((id) => round.moves[id]);
    if (completed.length === 1) {
      round.winnerId = completed[0];
      this._registerRoundWin(game, round.winnerId);
    } else {
      // nobody moved -> refresh deadline without awarding round
      round.deadline = now + ROUND_TIME_LIMIT_MS;
    }
  }

  _sweepAbandonedLobbies() {
    const now = Date.now();
    for (const [id, lobby] of this.lobbies.entries()) {
      if (lobby.status !== 'open') continue;
      if (now - lobby.createdAt > 60 * 60 * 1000) {
        this.lobbies.delete(id);
        const host = this.users.get(lobby.hostId);
        if (host && host.lobbyId === id) {
          host.lobbyId = null;
        }
      }
    }
  }
}

module.exports = {
  store: new GameStore(),
  MOVE_VALUES,
};
