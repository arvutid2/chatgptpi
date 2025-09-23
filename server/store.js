const { randomUUID } = require('crypto');

const MOVE_VALUES = ['rock', 'paper', 'scissors'];
const WIN_MAP = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

const ROUND_TIME_LIMIT_MS = 10_000;
const MAX_ROUND_WINS = 2;
const SYSTEM_FEE_RATIO = 0.1;
const MAX_HISTORY = 12;
const MAX_CHAT_MESSAGES = 60;
const NPC_AUTO_FRIENDS = 3;
const MAX_SYNTHETIC_NPCS = 24;
const DEFAULT_TOURNAMENT_DURATION_MINUTES = 120;
const TOURNAMENT_PAYOUT_SPLITS = [0.5, 0.3, 0.2];

const GAME_TYPES = {
  rps_pvp: {
    label: 'Rock · Paper · Scissors (PvP)',
    mode: 'pvp',
  },
  rps_ai: {
    label: 'Rock · Paper · Scissors (AI)',
    mode: 'ai',
  },
};

const AI_USER_PRESET = {
  username: 'ArcadeAI',
  avatar: '🤖',
  tagline: 'Adaptive sparring partner for Astra Games.',
  bio: 'Simulates cosmic meta so you can rehearse escrow flows and strategies.',
  balance: 50_000,
};

const NPC_PRESETS = [
  {
    username: 'FlipMaster',
    avatar: '🥞',
    tagline: 'Grandmaster of the golden pancake flip.',
    bio: 'A legendary tournament winner who trains every morning with syrup and stats.',
    wins: 64,
    losses: 22,
    balance: 2100,
  },
  {
    username: 'SyrupQueen',
    avatar: '👑',
    tagline: 'Ruler of sweet strategy.',
    bio: 'Pours syrup and strategy at exactly the right tempo.',
    wins: 53,
    losses: 17,
    balance: 1875,
  },
  {
    username: 'BerryBlitz',
    avatar: '🫐',
    tagline: 'Burst of berries and lightning-fast reads.',
    bio: 'Known for aggressive openings and relentlessly cheerful emotes.',
    wins: 41,
    losses: 31,
    balance: 1460,
  },
  {
    username: 'ChefSizzle',
    avatar: '🧑‍🍳',
    tagline: 'Head chef of the Pi Pancake House.',
    bio: 'Smells like caramelized butter and treats every match like brunch rush.',
    wins: 32,
    losses: 16,
    balance: 1720,
  },
  {
    username: 'CosmicWhisk',
    avatar: '🌌',
    tagline: 'Night-shift strategist.',
    bio: 'Late-night Pi Arcade legend swirling stars and stacking wins.',
    wins: 48,
    losses: 27,
    balance: 1635,
  },
];

const TOURNAMENT_PRESETS = [
  {
    id: 'pi-pancake-open',
    title: 'Cosmic Pancake Open',
    style: 'Swiss · 5 rounds',
    location: 'Syrup Stadium · Astra Orbit',
    entryFee: 25,
    prizePool: 500,
    slots: 32,
    startOffsetMinutes: 45,
    durationMinutes: 180,
  },
  {
    id: 'gravity-flip-cup',
    title: 'Gravity Flip Cup',
    style: 'Top 8 double-elim',
    location: 'Astra Arcade Lounge',
    entryFee: 50,
    prizePool: 1200,
    slots: 16,
    startOffsetMinutes: 240,
    durationMinutes: 240,
  },
  {
    id: 'midnight-batter-brawl',
    title: 'Midnight Nebula Brawl',
    style: 'Night Owl showdown',
    location: 'Galaxy Griddle Station',
    entryFee: 10,
    prizePool: 250,
    slots: 24,
    startOffsetMinutes: 720,
    durationMinutes: 180,
  },
];

const CHAT_SEED = [
  {
    username: 'FlipMaster',
    message: 'Welcome to Astra Games! Spar the AI and then bring a friend.',
  },
  {
    username: 'SyrupQueen',
    message: 'Set your buy-in — bigger risk, sweeter reward 🍯',
  },
  {
    username: 'ChefSizzle',
    message: 'AFK protection is live. 10 seconds and the pancakes burn! 🔥',
  },
];

class GameStore {
  constructor() {
    this.users = new Map();
    this.usersByName = new Map();
    this.sessions = new Map();
    this.lobbies = new Map();
    this.games = new Map();
    this.chat = [];
    this.tournaments = [];
    this.houseEarnings = 0;
    this.syntheticNpcCount = 0;
    this.aiUserId = null;

    this._seedWorld();
  }

  createSession(username) {
    const clean = this._ensureUsername(username);
    let user = this._getUserByUsername(clean);
    if (!user) {
      user = this._createUser(clean);
      this._autoFriendWelcome(user.id);
    }
    const token = randomUUID();
    this.sessions.set(token, { token, userId: user.id, createdAt: Date.now() });
    return { token, user: this._publicUser(user) };
  }

  endSession(token) {
    if (token) {
      this.sessions.delete(token);
    }
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

  requireUser(token) {
    if (!token) {
      throw this._error('Vaja on sisselogimist.', 401);
    }
    const session = this.sessions.get(token);
    if (!session) {
      throw this._error('Sessioon on aegunud.', 401);
    }
    const user = this.users.get(session.userId);
    if (!user) {
      this.sessions.delete(token);
      throw this._error('Kasutajat ei leitud.', 401);
    }
    return user;
  }

  listLobbies(token) {
    this._sweepExpiredLobbies();
    const viewerId = token && this.sessions.get(token) ? this.sessions.get(token).userId : null;
    return Array.from(this.lobbies.values())
      .filter((lobby) => lobby.status === 'open')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((lobby) => this._publicLobby(lobby, viewerId));
  }

  createLobby(token, payload = {}) {
    const user = this.requireUser(token);
    if (user.lobbyId) {
      throw this._error('You already have an active lobby.', 400);
    }
    if (this._hasActiveGame(user.id)) {
      throw this._error('Finish your current match before opening another lobby.', 400);
    }
    const stake = this._parseStake(payload.stake);
    const gameType = this._normalizeGameType(payload.gameType);
    if (stake <= 0) {
      throw this._error('Buy-in must be greater than 0.', 400);
    }
    if (stake > user.balance) {
      throw this._error('You do not have enough Pi for that buy-in.', 400);
    }
    const now = Date.now();
    const lobby = {
      id: randomUUID(),
      hostId: user.id,
      hostName: user.username,
      hostAvatar: user.avatar,
      stake,
      escrow: stake,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      gameType,
    };
    user.balance -= stake;
    user.lobbyId = lobby.id;
    user.updatedAt = now;
    this.lobbies.set(lobby.id, lobby);
    return this._publicLobby(lobby, user.id);
  }

  cancelLobby(token, lobbyId) {
    const user = this.requireUser(token);
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.status !== 'open') {
      throw this._error('Lobby not found.', 404);
    }
    if (lobby.hostId !== user.id) {
      throw this._error('Only the host can close the lobby.', 403);
    }
    this.lobbies.delete(lobby.id);
    user.balance += lobby.escrow;
    user.lobbyId = null;
    user.updatedAt = Date.now();
    return { success: true, balance: user.balance };
  }

  joinLobby(token, lobbyId) {
    const challenger = this.requireUser(token);
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.status !== 'open') {
      throw this._error('Lobby is already closed or does not exist.', 404);
    }
    if (lobby.hostId === challenger.id) {
      throw this._error('You cannot join your own lobby.', 400);
    }
    if (this._hasActiveGame(challenger.id)) {
      throw this._error('You already have an active match.', 400);
    }
    if (challenger.balance < lobby.stake) {
      throw this._error('You do not have enough balance for that buy-in.', 400);
    }
    const host = this.users.get(lobby.hostId);
    if (!host) {
      this.lobbies.delete(lobby.id);
      throw this._error('Lobby host disconnected. Please try again.', 400);
    }
    const descriptor = GAME_TYPES[lobby.gameType] || GAME_TYPES.rps_pvp;
    if (descriptor.mode !== 'pvp') {
      throw this._error('This lobby cannot be joined manually.', 400);
    }
    challenger.balance -= lobby.stake;
    lobby.status = 'matched';
    lobby.updatedAt = Date.now();
    const game = this._createGame(host, challenger, lobby);
    this.games.set(game.id, game);
    host.activeGames.add(game.id);
    challenger.activeGames.add(game.id);
    host.lobbyId = null;
    this.lobbies.delete(lobby.id);
    this._ensureRound(game);
    return this._publicGame(game, challenger.id);
  }

  createAiMatch(token, payload = {}) {
    const user = this.requireUser(token);
    if (this._hasActiveGame(user.id)) {
      throw this._error('You already have an active match.', 400);
    }
    const stake = this._parseStake(payload.stake);
    if (stake <= 0) {
      throw this._error('Buy-in must be greater than 0.', 400);
    }
    if (stake > user.balance) {
      throw this._error('You do not have enough Pi for that buy-in.', 400);
    }
    const ai = this._getAiUser();
    if (ai.balance < stake) {
      ai.balance += AI_USER_PRESET.balance;
    }
    const now = Date.now();
    user.balance -= stake;
    ai.balance -= stake;
    user.updatedAt = now;
    ai.updatedAt = now;

    const lobby = {
      id: randomUUID(),
      hostId: user.id,
      hostName: user.username,
      hostAvatar: user.avatar,
      stake,
      escrow: stake,
      createdAt: now,
      updatedAt: now,
      status: 'matched',
      gameType: 'rps_ai',
      aiOpponentId: ai.id,
    };

    const game = this._createGame(user, ai, lobby);
    this.games.set(game.id, game);
    user.activeGames.add(game.id);
    ai.activeGames.add(game.id);
    this._ensureRound(game);
    return this._publicGame(game, user.id);
  }
  listUserGames(token) {
    const user = this.requireUser(token);
    const summaries = [];
    for (const game of this.games.values()) {
      if (!this._isPlayerInGame(game, user.id)) continue;
      this._applyTimeout(game);
      summaries.push(this._gameSummary(game, user.id));
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  }

  getGame(token, gameId) {
    const user = this.requireUser(token);
    const game = this.games.get(gameId);
    if (!game || !this._isPlayerInGame(game, user.id)) {
      throw this._error('Game not found.', 404);
    }
    this._applyTimeout(game);
    return this._publicGame(game, user.id);
  }

  submitMove(token, gameId, move) {
    const user = this.requireUser(token);
    const cleanMove = typeof move === 'string' ? move.toLowerCase() : '';
    if (!MOVE_VALUES.includes(cleanMove)) {
      throw this._error('Only rock, paper, or scissors moves are allowed.', 400);
    }
    const game = this.games.get(gameId);
    if (!game || !this._isPlayerInGame(game, user.id)) {
      throw this._error('Game not found.', 404);
    }
    if (game.status !== 'in_progress') {
      throw this._error('The match has already finished.', 400);
    }
    this._applyTimeout(game);
    if (game.status !== 'in_progress') {
      return this._publicGame(game, user.id);
    }
    const round = this._ensureRound(game);
    if (round.moves[user.id]) {
      throw this._error('You already submitted this round.', 400);
    }
    round.moves[user.id] = cleanMove;
    round.firstMoveAt = round.firstMoveAt || Date.now();
    round.deadline = Date.now() + ROUND_TIME_LIMIT_MS;
    game.updatedAt = Date.now();

    if (game.mode === 'ai') {
      const aiId = game.aiOpponentId;
      if (aiId && !round.moves[aiId]) {
        this._aiMakeMove(game, round, aiId);
      }
      if (round.result) {
        return this._publicGame(game, user.id);
      }
    }

    const opponentId = this._opponentId(game, user.id);
    const opponentMove = round.moves[opponentId];
    if (opponentMove) {
      if (opponentMove === cleanMove) {
        this._completeRound(game, round, null, 'draw');
      } else if (WIN_MAP[cleanMove] === opponentMove) {
        this._completeRound(game, round, user.id, 'win');
      } else {
        this._completeRound(game, round, opponentId, 'win');
      }
    }

    return this._publicGame(game, user.id);
  }

  listFriends(token) {
    const user = this.requireUser(token);
    const friends = this._friendListForUser(user.id);
    const suggestions = this._suggestionsForUser(user.id, friends.map((friend) => friend.username));
    return { friends, suggestions };
  }

  addFriend(token, username) {
    const user = this.requireUser(token);
    const clean = this._ensureUsername(username);
    if (clean.toLowerCase() === user.username.toLowerCase()) {
      throw this._error('You cannot add yourself as a friend.', 400);
    }
    let target = this._getUserByUsername(clean);
    if (!target) {
      target = this._createNpcFromName(clean);
    }
    this._linkFriends(user.id, target.id);
    return this.listFriends(token);
  }

  removeFriend(token, username) {
    const user = this.requireUser(token);
    const clean = this._ensureUsername(username);
    const target = this._getUserByUsername(clean);
    if (!target) {
      throw this._error('User not found.', 404);
    }
    if (!user.friendIds.has(target.id)) {
      throw this._error('This user is not in your friends list.', 400);
    }
    this._unlinkFriends(user.id, target.id);
    return this.listFriends(token);
  }

  listTournaments(token) {
    const user = this.requireUser(token);
    return this.tournaments.map((tournament) => {
      this._refreshTournamentState(tournament);
      return this._publicTournament(tournament, user.id);
    });
  }

  joinTournament(token, tournamentId) {
    const user = this.requireUser(token);
    const tournament = this.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) {
      throw this._error('Tournament not found.', 404);
    }
    this._refreshTournamentState(tournament);
    if (tournament.completed) {
      throw this._error('Tournament has already ended.', 400);
    }
    if (
      tournament.entries.length >= tournament.slots &&
      !tournament.entries.some((entry) => entry.userId === user.id)
    ) {
      throw this._error('Tournament is full.', 400);
    }
    const fee = tournament.entryFee;
    if (user.balance < fee) {
      throw this._error('You do not have enough balance for that buy-in.', 400);
    }
    const now = Date.now();
    user.balance -= fee;
    user.stats.totalWagered += fee;
    user.stats.netEarnings -= fee;
    user.updatedAt = now;

    const match = this._runTournamentEntry(tournament, user, fee);
    const entry = {
      id: randomUUID(),
      userId: user.id,
      username: user.username,
      score: match.score,
      joinedAt: now,
      result: match.result,
      roundsWon: match.roundsWon,
      roundsLost: match.roundsLost,
      gameId: match.gameId,
    };
    tournament.entries.push(entry);
    tournament.participants.add(user.id);
    tournament.pot = (tournament.pot || 0) + fee;
    this._updateTournamentLeaderboard(tournament);
    this._refreshTournamentState(tournament);
    return this._publicTournament(tournament, user.id);
  }

  listChatMessages(token) {
    this.requireUser(token);
    return { messages: this.chat.slice(-MAX_CHAT_MESSAGES) };
  }

  postChatMessage(token, message) {
    const user = this.requireUser(token);
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      throw this._error('Message cannot be empty.', 400);
    }
    const entry = {
      id: randomUUID(),
      username: user.username,
      avatar: user.avatar,
      message: text.slice(0, 240),
      timestamp: Date.now(),
    };
    this.chat.push(entry);
    if (this.chat.length > MAX_CHAT_MESSAGES) {
      this.chat.splice(0, this.chat.length - MAX_CHAT_MESSAGES);
    }
    return { messages: this.chat.slice(-MAX_CHAT_MESSAGES) };
  }

  getProfile(username) {
    const clean = this._ensureUsername(username);
    const user = this._getUserByUsername(clean);
    if (!user) {
      return null;
    }
    const games = this.listUserGamesByUserId(user.id).slice(0, 10);
    return {
      user: this._publicUser(user),
      games,
      friends: this._friendListForUser(user.id),
    };
  }

  listUserGamesByUserId(userId) {
    const summaries = [];
    for (const game of this.games.values()) {
      if (!this._isPlayerInGame(game, userId)) continue;
      summaries.push(this._gameSummary(game, userId));
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  }
  _ensureUsername(username) {
    if (!username || typeof username !== 'string') {
      throw this._error('Username is required.', 400);
    }
    const clean = username.trim();
    if (!clean) {
      throw this._error('Username cannot be empty.', 400);
    }
    if (clean.length > 24) {
      throw this._error('Username is too long.', 400);
    }
    return clean;
  }

  _parseStake(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.round(num * 100) / 100);
  }

  _normalizeGameType(gameType, options = {}) {
    const allowAi = Boolean(options.allowAi);
    const key = typeof gameType === 'string' ? gameType.trim().toLowerCase() : '';
    if (key === 'rps_ai') {
      if (allowAi) return 'rps_ai';
      throw this._error('AI duels are launched from the dedicated panel.', 400);
    }
    if (!key) {
      return 'rps_pvp';
    }
    if (!GAME_TYPES[key] || GAME_TYPES[key].mode !== 'pvp') {
      throw this._error('That game package is not available yet.', 400);
    }
    return key;
  }

  _createUser(username, options = {}) {
    const now = Date.now();
    const user = {
      id: randomUUID(),
      username,
      balance: typeof options.balance === 'number' ? options.balance : 1000,
      stats: {
        wins: options.wins || 0,
        losses: options.losses || 0,
        gamesPlayed: options.gamesPlayed || 0,
        netEarnings: options.netEarnings || 0,
        totalWagered: options.totalWagered || 0,
        totalEarned: options.totalEarned || 0,
      },
      avatar: options.avatar || this._avatarFor(username),
      tagline: options.tagline || '',
      bio: options.bio || 'Astra Games pioneer.',
      lobbyId: null,
      activeGames: new Set(),
      history: [],
      friendIds: new Set(),
      createdAt: now,
      updatedAt: now,
      isNpc: Boolean(options.isNpc),
    };
    this.users.set(user.id, user);
    this.usersByName.set(username.toLowerCase(), user);
    return user;
  }

  _createNpcFromName(username) {
    if (this.syntheticNpcCount >= MAX_SYNTHETIC_NPCS) {
      throw this._error('The mock friend limit is reached. Try another player.', 400);
    }
    const palette = ['🍓', '🍌', '🥐', '🍫', '🍇', '🥭'];
    const emoji = palette[(username.length + this.syntheticNpcCount) % palette.length];
    const npc = this._createUser(username, {
      balance: 1000 + Math.floor(Math.random() * 400),
      wins: Math.floor(Math.random() * 40),
      losses: Math.floor(Math.random() * 30),
      avatar: emoji,
      tagline: 'PancakeSwap community member.',
      bio: 'Mock account waiting for the Pi Network mainnet link.',
      isNpc: true,
    });
    this.syntheticNpcCount += 1;
    return npc;
  }

  _getAiUser() {
    if (this.aiUserId) {
      const existing = this.users.get(this.aiUserId);
      if (existing) {
        return existing;
      }
    }
    const ai = this._createUser(AI_USER_PRESET.username, {
      avatar: AI_USER_PRESET.avatar,
      tagline: AI_USER_PRESET.tagline,
      bio: AI_USER_PRESET.bio,
      balance: AI_USER_PRESET.balance,
      isNpc: true,
    });
    this.aiUserId = ai.id;
    return ai;
  }

  _autoFriendWelcome(userId) {
    const user = this.users.get(userId);
    if (!user) return;
    const npcs = NPC_PRESETS.map((preset) => this._getUserByUsername(preset.username)).filter(Boolean);
    const available = npcs.filter((npc) => npc.id !== user.id);
    for (let i = 0; i < Math.min(NPC_AUTO_FRIENDS, available.length); i += 1) {
      this._linkFriends(user.id, available[i].id);
    }
  }

  _linkFriends(aId, bId) {
    if (!aId || !bId || aId === bId) return;
    const a = this.users.get(aId);
    const b = this.users.get(bId);
    if (!a || !b) return;
    a.friendIds.add(b.id);
    b.friendIds.add(a.id);
  }

  _unlinkFriends(aId, bId) {
    if (!aId || !bId || aId === bId) return;
    const a = this.users.get(aId);
    const b = this.users.get(bId);
    if (!a || !b) return;
    a.friendIds.delete(b.id);
    b.friendIds.delete(a.id);
  }

  _createGame(host, challenger, lobby) {
    const now = Date.now();
    const gameType = lobby.gameType || 'rps_pvp';
    const descriptor = GAME_TYPES[gameType] || GAME_TYPES.rps_pvp;
    const game = {
      id: randomUUID(),
      lobbyId: lobby.id,
      stake: lobby.stake,
      pot: lobby.stake * 2,
      players: [
        { id: host.id, username: host.username, avatar: host.avatar },
        { id: challenger.id, username: challenger.username, avatar: challenger.avatar },
      ],
      scores: {
        [host.id]: 0,
        [challenger.id]: 0,
      },
      rounds: [],
      status: 'in_progress',
      winnerId: null,
      resultReason: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      gameType,
      gameLabel: descriptor.label,
      mode: descriptor.mode,
      aiOpponentId: lobby.aiOpponentId || null,
    };
    return game;
  }

  _ensureRound(game) {
    if (game.status !== 'in_progress') {
      return null;
    }
    let round = game.rounds[game.rounds.length - 1];
    if (!round || round.result) {
      round = {
        number: game.rounds.length + 1,
        moves: {},
        result: null,
        createdAt: Date.now(),
        firstMoveAt: null,
        deadline: Date.now() + ROUND_TIME_LIMIT_MS,
        resolvedAt: null,
      };
      game.rounds.push(round);
    }
    return round;
  }

  _aiMakeMove(game, round, aiId) {
    if (!game || !round || round.result || !aiId) return;
    const move = this._aiChooseMove(game, aiId);
    if (!move) return;
    round.moves[aiId] = move;
    round.firstMoveAt = round.firstMoveAt || Date.now();
    round.deadline = Date.now() + ROUND_TIME_LIMIT_MS;
    game.updatedAt = Date.now();
    const opponentId = this._opponentId(game, aiId);
    const opponentMove = opponentId ? round.moves[opponentId] : null;
    if (!opponentMove) {
      return;
    }
    if (opponentMove === move) {
      this._completeRound(game, round, null, 'draw');
    } else if (WIN_MAP[move] === opponentMove) {
      this._completeRound(game, round, aiId, 'win');
    } else {
      this._completeRound(game, round, opponentId, 'win');
    }
  }

  _aiChooseMove(game, aiId) {
    const opponentId = this._opponentId(game, aiId);
    if (!opponentId) {
      return this._randomMove();
    }
    const counts = { rock: 0, paper: 0, scissors: 0 };
    for (const round of game.rounds) {
      const move = round.moves[opponentId];
      if (move && counts[move] !== undefined) {
        counts[move] += 1;
      }
    }
    const total = counts.rock + counts.paper + counts.scissors;
    if (total === 0) {
      return this._randomMove();
    }
    const [mostPlayed, amount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!mostPlayed || amount === 0 || Math.random() < 0.3) {
      return this._randomMove();
    }
    return this._counterMove(mostPlayed);
  }

  _randomMove() {
    return MOVE_VALUES[Math.floor(Math.random() * MOVE_VALUES.length)];
  }

  _counterMove(move) {
    switch (move) {
      case 'rock':
        return 'paper';
      case 'paper':
        return 'scissors';
      default:
        return 'rock';
    }
  }

  _applyTimeout(game) {
    if (game.status !== 'in_progress') return;
    const round = game.rounds[game.rounds.length - 1];
    if (!round || round.result) return;
    if (!round.deadline || Date.now() < round.deadline) return;
    const [a, b] = game.players.map((player) => player.id);
    const moveA = round.moves[a];
    const moveB = round.moves[b];
    if (moveA && !moveB) {
      this._completeRound(game, round, a, 'timeout');
    } else if (moveB && !moveA) {
      this._completeRound(game, round, b, 'timeout');
    } else {
      round.deadline = Date.now() + ROUND_TIME_LIMIT_MS;
    }
  }

  _completeRound(game, round, winnerId, reason) {
    if (round.result) return;
    round.result = { winnerId, reason };
    round.resolvedAt = Date.now();
    if (winnerId) {
      game.scores[winnerId] = (game.scores[winnerId] || 0) + 1;
      if (game.scores[winnerId] >= MAX_ROUND_WINS) {
        this._finalizeGame(game, winnerId, reason);
        return;
      }
    }
    if (game.status === 'in_progress') {
      this._ensureRound(game);
    }
  }
  _finalizeGame(game, winnerId, reason) {
    if (game.status !== 'in_progress') return;
    const loserId = game.players.map((player) => player.id).find((id) => id !== winnerId);
    const winner = this.users.get(winnerId);
    const loser = this.users.get(loserId);
    game.status = 'completed';
    game.winnerId = winnerId;
    game.resultReason = reason;
    game.completedAt = Date.now();
    game.updatedAt = game.completedAt;

    const pot = game.pot;
    const fee = Math.round(pot * SYSTEM_FEE_RATIO * 100) / 100;
    const payout = pot - fee;

    if (winner) {
      winner.balance += payout;
      winner.stats.wins += 1;
      winner.stats.gamesPlayed += 1;
      winner.stats.totalEarned += payout;
      winner.stats.totalWagered += game.stake;
      winner.stats.netEarnings += payout - game.stake;
      winner.activeGames.delete(game.id);
      this._recordGameSummary(winner, game, 'win');
    }
    if (loser) {
      loser.stats.losses += 1;
      loser.stats.gamesPlayed += 1;
      loser.stats.totalWagered += game.stake;
      loser.stats.netEarnings -= game.stake;
      loser.activeGames.delete(game.id);
      this._recordGameSummary(loser, game, 'loss');
    }
    this.houseEarnings += fee;
  }

  _recordGameSummary(user, game, outcome) {
    if (!user) return;
    const opponent = game.players.find((player) => player.id !== user.id);
    const youScore = game.scores[user.id] || 0;
    const oppScore = opponent ? game.scores[opponent.id] || 0 : 0;
    const entryFee =
      typeof game.tournamentEntryFee === 'number' ? Math.max(0, Number(game.tournamentEntryFee)) : null;
    const stake = entryFee !== null ? entryFee : game.stake;
    const tournament = entryFee !== null ? this._findTournament(game.tournamentId) : null;
    const tournamentPot = tournament ? Math.max(0, Number(tournament.pot || 0)) : null;
    const pot = entryFee !== null && tournamentPot !== null ? tournamentPot : game.pot;
    const summary = {
      id: game.id,
      opponent: opponent ? opponent.username : '—',
      opponentAvatar: opponent ? opponent.avatar : '❔',
      pot,
      stake,
      result: outcome,
      score: `${youScore}-${oppScore}`,
      youScore,
      opponentScore: oppScore,
      completedAt: game.completedAt,
      reason: game.resultReason,
      gameLabel: game.gameLabel,
      mode: game.mode,
      tournamentId: game.tournamentId || null,
      tournamentEntryFee: entryFee,
      tournamentPot,
    };
    user.history.push(summary);
    if (user.history.length > MAX_HISTORY) {
      user.history.splice(0, user.history.length - MAX_HISTORY);
    }
  }

  _gameSummary(game, viewerId) {
    const opponentId = this._opponentId(game, viewerId);
    const opponent = opponentId ? this.users.get(opponentId) : null;
    const youScore = game.scores[viewerId] || 0;
    const oppScore = opponentId ? game.scores[opponentId] || 0 : 0;
    const entryFee =
      typeof game.tournamentEntryFee === 'number' ? Math.max(0, Number(game.tournamentEntryFee)) : null;
    const stake = entryFee !== null ? entryFee : game.stake;
    const tournament = entryFee !== null ? this._findTournament(game.tournamentId) : null;
    const tournamentPot = tournament ? Math.max(0, Number(tournament.pot || 0)) : null;
    const pot = entryFee !== null && tournamentPot !== null ? tournamentPot : game.pot;
    return {
      id: game.id,
      status: game.status,
      stake,
      pot,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      completedAt: game.completedAt,
      gameType: game.gameType,
      gameLabel: game.gameLabel,
      mode: game.mode,
      isAi: game.mode === 'ai',
      opponent: opponent
        ? { username: opponent.username, avatar: opponent.avatar }
        : { username: '—', avatar: '❔' },
      youScore,
      opponentScore: oppScore,
      winnerId: game.winnerId,
      result: game.winnerId
        ? game.winnerId === viewerId
          ? 'win'
          : 'loss'
        : game.status === 'completed'
        ? 'draw'
        : null,
      reason: game.resultReason,
      canMove: this._canPlayerMove(game, viewerId),
      tournamentId: game.tournamentId || null,
      tournamentEntryFee: entryFee,
      tournamentPot,
    };
  }

  _publicGame(game, viewerId) {
    const entryFee =
      typeof game.tournamentEntryFee === 'number' ? Math.max(0, Number(game.tournamentEntryFee)) : null;
    const tournament = entryFee !== null ? this._findTournament(game.tournamentId) : null;
    const tournamentPot = tournament ? Math.max(0, Number(tournament.pot || 0)) : null;
    const stake = entryFee !== null ? entryFee : game.stake;
    const pot = entryFee !== null && tournamentPot !== null ? tournamentPot : game.pot;
    const players = game.players.map((player) => ({
      id: player.id,
      username: player.username,
      avatar: player.avatar,
      score: game.scores[player.id] || 0,
      isAi: game.aiOpponentId ? player.id === game.aiOpponentId : false,
    }));
    const currentRound = game.rounds.find((round) => !round.result) || null;
    const viewRounds = game.rounds.map((round) => {
      const moves = {};
      for (const player of game.players) {
        const move = round.moves[player.id];
        if (!move) {
          moves[player.username] = null;
          continue;
        }
        if (round.result || player.id === viewerId) {
          moves[player.username] = move;
        } else {
          moves[player.username] = round.moves[viewerId] ? move : null;
        }
      }
      return {
        number: round.number,
        moves,
        result: round.result,
        deadline: round.deadline,
      };
    });
    return {
      id: game.id,
      status: game.status,
      stake,
      pot,
      gameType: game.gameType,
      gameLabel: game.gameLabel,
      mode: game.mode,
      isAiMatch: game.mode === 'ai',
      players,
      rounds: viewRounds,
      currentRound: currentRound ? currentRound.number : null,
      deadline: currentRound ? currentRound.deadline : null,
      winnerId: game.winnerId,
      resultReason: game.resultReason,
      canMove: this._canPlayerMove(game, viewerId),
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      completedAt: game.completedAt,
      tournamentId: game.tournamentId || null,
      tournamentEntryFee: entryFee,
      tournamentPot,
    };
  }

  _friendListForUser(userId) {
    const user = this.users.get(userId);
    if (!user) return [];
    return Array.from(user.friendIds)
      .map((friendId) => this.users.get(friendId))
      .filter(Boolean)
      .map((friend) => ({
        username: friend.username,
        avatar: friend.avatar,
        status: this._statusForFriend(friend.id),
        record: {
          wins: friend.stats.wins,
          losses: friend.stats.losses,
        },
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  _suggestionsForUser(userId, existingNames = []) {
    const names = new Set(existingNames.map((name) => name.toLowerCase()));
    const results = [];
    for (const preset of NPC_PRESETS) {
      if (names.has(preset.username.toLowerCase())) continue;
      const user = this._getUserByUsername(preset.username);
      if (!user || user.id === userId) continue;
      results.push({
        username: user.username,
        avatar: user.avatar,
        status: this._statusForFriend(user.id),
        record: {
          wins: user.stats.wins,
          losses: user.stats.losses,
        },
      });
    }
    return results.slice(0, NPC_PRESETS.length);
  }

  _statusForFriend(userId) {
    const seed = userId.charCodeAt(0) + userId.length;
    return seed % 3 === 0 ? 'in_game' : seed % 2 === 0 ? 'online' : 'offline';
  }

  _refreshTournamentState(tournament) {
    if (!tournament) return;
    if (tournament.completed) {
      tournament.status = 'completed';
      return;
    }
    const now = Date.now();
    if (now >= tournament.endTime) {
      this._completeTournament(tournament);
      return;
    }
    if (now >= tournament.startTime) {
      tournament.status = 'running';
    } else {
      tournament.status = 'upcoming';
    }
    this._updateTournamentLeaderboard(tournament);
  }

  _updateTournamentLeaderboard(tournament) {
    if (!tournament) return;
    const bestByUser = new Map();
    const counts = new Map();
    for (const entry of tournament.entries) {
      counts.set(entry.userId, (counts.get(entry.userId) || 0) + 1);
      const current = bestByUser.get(entry.userId);
      if (!current || entry.score > current.score || (entry.score === current.score && entry.joinedAt < current.joinedAt)) {
        bestByUser.set(entry.userId, {
          userId: entry.userId,
          username: entry.username,
          score: entry.score,
          joinedAt: entry.joinedAt,
        });
      }
    }
    const leaderboard = Array.from(bestByUser.values()).map((entry) => ({
      userId: entry.userId,
      username: entry.username,
      score: entry.score,
      joinedAt: entry.joinedAt,
      entries: counts.get(entry.userId) || 1,
    }));
    leaderboard.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.joinedAt - b.joinedAt;
    });
    tournament.leaderboard = leaderboard;
  }

  _publicTournament(tournament, viewerId) {
    this._updateTournamentLeaderboard(tournament);
    const leaderboard = (tournament.leaderboard || []).slice(0, 5).map((entry, index) => ({
      rank: index + 1,
      username: entry.username,
      score: entry.score,
      entries: entry.entries,
    }));
    const userEntries = tournament.entries.filter((entry) => entry.userId === viewerId).length;
    const now = Date.now();
    const status = tournament.completed
      ? 'completed'
      : now >= tournament.startTime
      ? 'running'
      : 'upcoming';
    return {
      id: tournament.id,
      title: tournament.title,
      style: tournament.style,
      location: tournament.location,
      entryFee: tournament.entryFee,
      prizePool: tournament.prizePool,
      slots: tournament.slots,
      startTime: tournament.startTime,
      endTime: tournament.endTime,
      status,
      participants: tournament.participants.size,
      totalEntries: tournament.entries.length,
      leaderboard,
      userEntries,
      isRegistered: userEntries > 0,
      currentPot: tournament.pot || 0,
      payouts: tournament.completed ? tournament.payouts : [],
      completedAt: tournament.completedAt || null,
      houseCut: tournament.houseCut || 0,
    };
  }

  _runTournamentEntry(tournament, user, fee) {
    const opponent = this._getAiUser();
    const now = Date.now();
    const lobby = {
      id: randomUUID(),
      hostId: user.id,
      hostName: user.username,
      hostAvatar: user.avatar,
      stake: 0,
      escrow: 0,
      createdAt: now,
      updatedAt: now,
      status: 'matched',
      gameType: tournament.gameType || 'rps_pvp',
      aiOpponentId: opponent.id,
    };
    const game = this._createGame(user, opponent, lobby);
    game.tournamentId = tournament.id;
    game.tournamentEntryFee = fee;
    game.pot = 0;
    game.stake = 0;
    this.games.set(game.id, game);
    user.activeGames.add(game.id);
    opponent.activeGames.add(game.id);
    this._ensureRound(game);
    this._autoResolveTournamentGame(game, user.id, opponent.id);
    const yourRounds = game.scores[user.id] || 0;
    const oppRounds = game.scores[opponent.id] || 0;
    const margin = yourRounds - oppRounds;
    const victory = margin > 0;
    const baseScore = victory ? 120 : 65;
    const score = Math.max(20, Math.round(baseScore + margin * 20 + Math.random() * 12));
    game.tournamentScore = score;
    return {
      score,
      result: victory ? 'win' : margin === 0 ? 'draw' : 'loss',
      roundsWon: yourRounds,
      roundsLost: oppRounds,
      gameId: game.id,
    };
  }

  _autoResolveTournamentGame(game, userId, opponentId) {
    let guard = 0;
    while (game.status === 'in_progress' && guard < 12) {
      const round = this._ensureRound(game);
      if (!round) break;
      round.moves[userId] = this._randomMove();
      round.firstMoveAt = round.firstMoveAt || Date.now();
      round.deadline = Date.now() + ROUND_TIME_LIMIT_MS;
      if (game.aiOpponentId === opponentId) {
        this._aiMakeMove(game, round, opponentId);
      }
      if (!round.moves[opponentId]) {
        round.moves[opponentId] = this._randomMove();
      }
      if (!round.result) {
        const yourMove = round.moves[userId];
        const oppMove = round.moves[opponentId];
        if (yourMove === oppMove) {
          this._completeRound(game, round, null, 'draw');
        } else if (WIN_MAP[yourMove] === oppMove) {
          this._completeRound(game, round, userId, 'win');
        } else {
          this._completeRound(game, round, opponentId, 'win');
        }
      }
      guard += 1;
    }
    if (game.status !== 'completed') {
      const round = this._ensureRound(game);
      if (round && !round.result) {
        this._completeRound(game, round, null, 'draw');
      }
      game.status = 'completed';
      game.completedAt = Date.now();
      game.updatedAt = game.completedAt;
    }
  }

  _completeTournament(tournament) {
    if (!tournament || tournament.completed) {
      if (tournament) {
        tournament.status = 'completed';
      }
      return;
    }
    this._updateTournamentLeaderboard(tournament);
    const pot = tournament.pot || 0;
    const houseCut = Math.round(pot * SYSTEM_FEE_RATIO * 100) / 100;
    const payoutPool = Math.max(0, pot - houseCut);
    const now = Date.now();
    const payouts = [];
    const contenders = (tournament.leaderboard || []).slice(0, 3);
    contenders.forEach((entry, index) => {
      const split = TOURNAMENT_PAYOUT_SPLITS[index] || 0;
      if (split <= 0) return;
      const reward = Math.round(payoutPool * split * 100) / 100;
      if (reward <= 0) return;
      const user = this.users.get(entry.userId);
      if (user) {
        user.balance += reward;
        user.stats.totalEarned += reward;
        user.stats.netEarnings += reward;
        user.updatedAt = now;
      }
      payouts.push({
        username: entry.username,
        userId: entry.userId,
        score: entry.score,
        reward,
      });
    });
    tournament.completed = true;
    tournament.completedAt = now;
    tournament.status = 'completed';
    tournament.payouts = payouts;
    tournament.houseCut = (tournament.houseCut || 0) + houseCut;
    this.houseEarnings += houseCut;
  }

  _sweepExpiredLobbies() {
    const now = Date.now();
    for (const lobby of Array.from(this.lobbies.values())) {
      if (lobby.status !== 'open') continue;
      if (now - lobby.createdAt > 30 * 60 * 1000) {
        const host = this.users.get(lobby.hostId);
        if (host) {
          host.balance += lobby.escrow;
          host.lobbyId = null;
        }
        this.lobbies.delete(lobby.id);
      }
    }
  }

  _hasActiveGame(userId) {
    const user = this.users.get(userId);
    return user ? user.activeGames.size > 0 : false;
  }

  _isPlayerInGame(game, userId) {
    return game.players.some((player) => player.id === userId);
  }

  _opponentId(game, userId) {
    const opponent = game.players.find((player) => player.id !== userId);
    return opponent ? opponent.id : null;
  }

  _canPlayerMove(game, userId) {
    if (game.status !== 'in_progress') return false;
    const round = game.rounds[game.rounds.length - 1];
    if (!round || round.result) return false;
    return !round.moves[userId];
  }

  _publicLobby(lobby, viewerId) {
    const descriptor = GAME_TYPES[lobby.gameType] || GAME_TYPES.rps_pvp;
    return {
      id: lobby.id,
      stake: lobby.stake,
      gameType: lobby.gameType,
      gameLabel: descriptor.label,
      mode: descriptor.mode,
      host: {
        username: lobby.hostName,
        avatar: lobby.hostAvatar,
      },
      createdAt: lobby.createdAt,
      isYours: viewerId ? lobby.hostId === viewerId : false,
    };
  }

  _publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      balance: user.balance,
      lobbyId: user.lobbyId,
      stats: { ...user.stats },
      avatar: user.avatar,
      tagline: user.tagline,
      bio: user.bio,
      friendCount: user.friendIds.size,
      history: user.history.slice(-MAX_HISTORY),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  _findTournament(id) {
    if (!id) return null;
    return this.tournaments.find((item) => item.id === id) || null;
  }

  _avatarFor(name) {
    const palette = ['🥞', '🍯', '🍓', '🍫', '🧇', '☕', '🍌', '✨'];
    if (!name) return palette[0];
    const code = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return palette[code % palette.length];
  }

  _getUserByUsername(username) {
    return this.usersByName.get(username.toLowerCase()) || null;
  }

  _seedWorld() {
    for (const preset of NPC_PRESETS) {
      const user = this._createUser(preset.username, {
        avatar: preset.avatar,
        tagline: preset.tagline,
        bio: preset.bio,
        wins: preset.wins,
        losses: preset.losses,
        balance: preset.balance,
        isNpc: true,
      });
      user.stats.gamesPlayed = preset.wins + preset.losses;
      user.stats.totalWagered = (preset.wins + preset.losses) * 15;
      user.stats.totalEarned = preset.wins * 25;
      user.stats.netEarnings = user.stats.totalEarned - user.stats.totalWagered / 2;
    }
    this._getAiUser();
    const now = Date.now();
    for (const preset of TOURNAMENT_PRESETS) {
      const duration = (preset.durationMinutes || DEFAULT_TOURNAMENT_DURATION_MINUTES) * 60 * 1000;
      const offsetMinutes = Math.min(Math.max(preset.startOffsetMinutes || 20, 10), 45);
      const startTime = now - offsetMinutes * 60 * 1000;
      const endTime = startTime + duration;
      this.tournaments.push({
        id: preset.id,
        title: preset.title,
        style: preset.style,
        location: preset.location,
        entryFee: preset.entryFee,
        prizePool: preset.prizePool,
        slots: preset.slots,
        startTime,
        endTime,
        status: 'running',
        participants: new Set(),
        entries: [],
        leaderboard: [],
        pot: 0,
        payouts: [],
        houseCut: 0,
        completed: false,
        completedAt: null,
      });
    }
    this.chat = CHAT_SEED.map((entry) => ({
      id: randomUUID(),
      username: entry.username,
      avatar: this._avatarFor(entry.username),
      message: entry.message,
      timestamp: Date.now(),
    }));
  }

  _error(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }
}

const store = new GameStore();

module.exports = {
  store,
  MOVE_VALUES,
};
