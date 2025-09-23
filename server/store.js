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
const FRIEND_AUTOFILL = 3;
const CHAT_HISTORY_LIMIT = 60;
const CUSTOM_NPC_LIMIT = 24;

const NPC_PRESETS = [
  {
    username: 'ChefSizzle',
    title: 'Siroopia peakokk',
    bio: 'Pannkoogikunstnik, kes usub, et iga voor vajab täiuslikku pöördetrajektoori.',
    avatar: '🧑‍🍳',
    balance: 1680,
    wins: 42,
    losses: 17,
  },
  {
    username: 'SyrupQueen',
    title: 'Magusa strateegia meister',
    bio: 'Tilgutan taktikaid nagu vahtrasiirupit – aeglaselt, täpselt ja alati maitsvalt.',
    avatar: '👑',
    balance: 2140,
    wins: 58,
    losses: 21,
  },
  {
    username: 'FlipMaster',
    title: 'Kuldse pöörde guru',
    bio: 'Vaatan vastaseid nagu pannkooke – kui nad liiga kaua paigal püsivad, pööran mängu ümber.',
    avatar: '🥞',
    balance: 1935,
    wins: 37,
    losses: 9,
  },
  {
    username: 'BerryBlitz',
    title: 'Marjane võiduotsija',
    bio: 'Toon igasse duelli värske marjalise energia ja häid vibesid.',
    avatar: '🫐',
    balance: 1490,
    wins: 31,
    losses: 22,
  },
];

const TOURNAMENT_PRESETS = [
  {
    slug: 'pi-pancake-open',
    title: 'Pi Pancake Open',
    style: 'Swiss · 5 vooru',
    location: 'Syrup Stadium (virtuaal)',
    entryFee: 25,
    prizePool: 500,
    slots: 32,
    startOffsetMinutes: 45,
  },
  {
    slug: 'gravity-flip-cup',
    title: 'Gravity Flip Cup',
    style: 'Top 8 double-elim',
    location: 'Pi Arcade Lounge',
    entryFee: 50,
    prizePool: 1200,
    slots: 16,
    startOffsetMinutes: 240,
  },
  {
    slug: 'midnight-batter-brawl',
    title: 'Midnight Batter Brawl',
    style: 'Night Owl showdown',
    location: 'Galaxy Griddle',
    entryFee: 10,
    prizePool: 250,
    slots: 24,
    startOffsetMinutes: 720,
  },
];

class GameStore {
  constructor() {
    this.users = new Map();
    this.usersByName = new Map();
    this.sessions = new Map();
    this.lobbies = new Map();
    this.games = new Map();
    this.houseEarnings = 0;
    this.friendships = new Map();
    this.tournaments = [];
    this.chatMessages = [];
    this.npcIds = new Set();
    this._worldSeeded = false;
    this.generatedNpcCount = 0;

    this._seedWorld();
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

  _createUser(username, options = {}) {
    const now = Date.now();
    const { isNpc = false, avatar = null, bio = '', title = '', tagline = '', highlight = '' } = options;
    const user = {
      id: randomUUID(),
      username,
      balance: typeof options.balance === 'number' ? options.balance : 1000,
      stats: {
        wins: options.wins || 0,
        losses: options.losses || 0,
        gamesPlayed: options.gamesPlayed || 0,
        netEarnings: options.netEarnings || 0,
        totalEarned: options.totalEarned || 0,
        totalWagered: options.totalWagered || 0,
      },
      lobbyId: null,
      activeGames: new Set(),
      completedGames: [],
      createdAt: now,
      updatedAt: now,
      avatar: avatar || this._avatarForName(username),
      isNpc: Boolean(isNpc),
      bio: bio || (isNpc ? 'Legendaarne PancakeSwap kogukonna tegelane.' : 'Pi Duel Arena pioneer.'),
      title: title || (isNpc ? 'Pi maailmameister' : 'Pi Duelist'),
      tagline: tagline || '',
      highlight: highlight || '',
    };
    user.friends = new Set();
    this.users.set(user.id, user);
    this.usersByName.set(username.toLowerCase(), user);
    this.friendships.set(user.id, user.friends);
    if (user.isNpc) {
      this.npcIds.add(user.id);
    } else {
      this._autoWelcomeFriends(user);
    }
    return user;
  }

  _getUserByUsername(username) {
    return this.usersByName.get(username.toLowerCase()) || null;
  }

  _avatarForName(name) {
    const palette = ['🥞', '🍯', '🍓', '🍫', '🧇', '☕', '🍌', '✨'];
    if (!name) {
      return palette[0];
    }
    const score = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return palette[score % palette.length];
  }

  _autoWelcomeFriends(user) {
    if (!user || this.npcIds.size === 0) return;
    const available = Array.from(this.npcIds).filter((npcId) => npcId !== user.id);
    if (available.length === 0) return;
    const shuffled = available.sort(() => Math.random() - 0.5);
    const target = Math.min(FRIEND_AUTOFILL, shuffled.length);
    for (let i = 0; i < target; i += 1) {
      this._linkFriends(user.id, shuffled[i]);
    }
  }

  _linkFriends(userId, friendId) {
    if (!userId || !friendId || userId === friendId) return;
    const userFriends = this.friendships.get(userId) || new Set();
    const friendFriends = this.friendships.get(friendId) || new Set();
    userFriends.add(friendId);
    friendFriends.add(userId);
    this.friendships.set(userId, userFriends);
    this.friendships.set(friendId, friendFriends);
  }

  _seedWorld() {
    if (this._worldSeeded) return;
    this._worldSeeded = true;
    const now = Date.now();
    NPC_PRESETS.forEach((preset, index) => {
      const npc = this._createUser(preset.username, {
        isNpc: true,
        avatar: preset.avatar,
        bio: preset.bio,
        title: preset.title,
        balance: preset.balance,
        wins: preset.wins,
        losses: preset.losses,
        gamesPlayed: preset.wins + preset.losses,
        netEarnings: Math.round((preset.wins - preset.losses) * 6),
        totalEarned: Math.round(preset.wins * 12),
        totalWagered: Math.round((preset.wins + preset.losses) * 9),
        highlight: index % 2 === 0 ? 'Legendaarne Pancake League liige' : 'Pi Network pioneer',
      });
      npc.updatedAt = now - Math.floor(Math.random() * 3600 * 1000);
      npc.tagline = preset.bio;
    });

    const npcIds = Array.from(this.npcIds);
    for (let i = 0; i < npcIds.length; i += 1) {
      for (let j = i + 1; j < npcIds.length; j += 1) {
        this._linkFriends(npcIds[i], npcIds[j]);
      }
    }

    this.tournaments = TOURNAMENT_PRESETS.map((preset, idx) => this._createTournamentFromPreset(preset, now, idx));
    this.tournaments.forEach((tournament, idx) => {
      const participants = Array.from(this.npcIds).slice(0, Math.min(6 + idx, this.npcIds.size));
      participants.forEach((npcId) => tournament.participants.add(npcId));
    });

    this.chatMessages = [
      {
        id: randomUUID(),
        userId: null,
        username: 'Pi Duel AI',
        avatar: '🤖',
        message: 'Tere tulemast Pi Duel Arenale! Siruta sõrmi ja soojenda strateegiat PancakeSwap vibega.',
        createdAt: now - 120000,
        tone: 'system',
      },
      {
        id: randomUUID(),
        userId: this._getUserByUsername('ChefSizzle')?.id || null,
        username: 'ChefSizzle',
        avatar: '🧑‍🍳',
        message: 'Kes tuleb täna õhtul Gravity Flip Cup turnale? Mul on taskus värske vahtrasiirup.',
        createdAt: now - 60000,
        tone: 'chat',
      },
    ];
  }

  _createTournamentFromPreset(preset, now, index) {
    return {
      id: preset.slug,
      title: preset.title,
      style: preset.style,
      location: preset.location,
      entryFee: preset.entryFee,
      prizePool: preset.prizePool,
      slots: preset.slots,
      startTime: now + preset.startOffsetMinutes * 60 * 1000,
      createdAt: now,
      highlightColor: index % 2 === 0 ? '#ffb237' : '#31d0aa',
      participants: new Set(),
    };
  }

  _isUserOnline(userId) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        return true;
      }
    }
    return false;
  }

  _presenceStatus(user) {
    const online = this._isUserOnline(user.id);
    return {
      status: online ? 'online' : 'offline',
      lastSeen: user.updatedAt,
    };
  }

  _friendCard(viewerId, friendId) {
    const friend = this.users.get(friendId);
    if (!friend) return null;
    const presence = this._presenceStatus(friend);
    const record = this._headToHeadRecord(viewerId, friendId);
    return {
      id: friend.id,
      username: friend.username,
      avatar: friend.avatar,
      title: friend.title,
      bio: friend.bio,
      status: presence.status,
      lastSeen: presence.lastSeen,
      record,
      isNpc: friend.isNpc,
      highlight: friend.highlight,
    };
  }

  _headToHeadRecord(aId, bId) {
    if (!aId || !bId) {
      return { wins: 0, losses: 0 };
    }
    let wins = 0;
    let losses = 0;
    for (const game of this.games.values()) {
      if (!game.players || game.status !== 'completed') continue;
      const hasA = game.players.some((p) => p.userId === aId);
      const hasB = game.players.some((p) => p.userId === bId);
      if (!hasA || !hasB) continue;
      if (game.winnerId === aId) {
        wins += 1;
      } else if (game.winnerId === bId) {
        losses += 1;
      }
    }
    return { wins, losses };
  }

  _friendListForUser(userId) {
    const set = this.friendships.get(userId);
    if (!set || set.size === 0) return [];
    return Array.from(set)
      .map((friendId) => this._friendCard(userId, friendId))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.status === b.status) {
          return a.username.localeCompare(b.username);
        }
        return a.status === 'online' ? -1 : 1;
      });
  }

  _friendSuggestions(userId, limit = 4) {
    const userFriends = this.friendships.get(userId) || new Set();
    const suggestions = [];
    for (const npcId of this.npcIds) {
      if (npcId === userId) continue;
      if (userFriends.has(npcId)) continue;
      const card = this._friendCard(userId, npcId);
      if (card) {
        suggestions.push(card);
      }
      if (suggestions.length >= limit) break;
    }
    return suggestions;
  }

  _publicTournament(tournament, viewerId = null) {
    const isRegistered = viewerId ? tournament.participants.has(viewerId) : false;
    const participantCount = tournament.participants.size;
    return {
      id: tournament.id,
      title: tournament.title,
      style: tournament.style,
      location: tournament.location,
      entryFee: tournament.entryFee,
      prizePool: tournament.prizePool,
      slots: tournament.slots,
      startTime: tournament.startTime,
      highlightColor: tournament.highlightColor,
      participants: participantCount,
      spotsRemaining: Math.max(tournament.slots - participantCount, 0),
      isRegistered,
    };
  }

  _publicChatMessage(entry) {
    const fallbackAvatar = entry.userId ? this.users.get(entry.userId)?.avatar : null;
    return {
      id: entry.id,
      userId: entry.userId || null,
      username: entry.username,
      avatar: entry.avatar || fallbackAvatar || '🥞',
      message: entry.message,
      createdAt: entry.createdAt,
      tone: entry.tone || 'chat',
    };
  }

  _trimChat() {
    while (this.chatMessages.length > CHAT_HISTORY_LIMIT) {
      this.chatMessages.shift();
    }
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
    const friends = this.friendships.get(user.id);
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
      avatar: user.avatar,
      title: user.title,
      bio: user.bio,
      tagline: user.tagline,
      highlight: user.highlight,
      isNpc: user.isNpc,
      friendCount: friends ? friends.size : 0,
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
      friends: this._friendListForUser(user.id),
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

  listFriends(token) {
    const user = this._requireUserBySession(token);
    return {
      friends: this._friendListForUser(user.id),
      suggestions: this._friendSuggestions(user.id),
    };
  }

  addFriend(token, username) {
    const user = this._requireUserBySession(token);
    const clean = this._ensureUsername(username);
    let friend = this._getUserByUsername(clean);
    if (!friend) {
      if (this.generatedNpcCount >= CUSTOM_NPC_LIMIT) {
        throw new Error('Mock tegelaste limiit on täis. Lisa olemasolevaid sõpru või oota päris kasutajaid.');
      }
      friend = this._createUser(clean, {
        isNpc: true,
        bio: `${clean} liitus Pi Duel kogukonnaga.`,
        title: 'Kogukonna liige',
      });
      friend.updatedAt = Date.now();
      this.generatedNpcCount += 1;
    }
    if (friend.id === user.id) {
      throw new Error('Ei saa iseennast sõbraks lisada.');
    }
    const userFriends = this.friendships.get(user.id) || new Set();
    if (userFriends.has(friend.id)) {
      return {
        friends: this._friendListForUser(user.id),
        suggestions: this._friendSuggestions(user.id),
      };
    }
    this._linkFriends(user.id, friend.id);
    user.updatedAt = Date.now();
    return {
      friends: this._friendListForUser(user.id),
      suggestions: this._friendSuggestions(user.id),
    };
  }

  listTournaments(token) {
    const user = this._requireUserBySession(token);
    return this.tournaments.map((tournament) => this._publicTournament(tournament, user.id));
  }

  joinTournament(token, tournamentId) {
    const user = this._requireUserBySession(token);
    const tournament = this.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) {
      throw new Error('Turniiri ei leitud.');
    }
    if (tournament.participants.has(user.id)) {
      return this._publicTournament(tournament, user.id);
    }
    if (tournament.participants.size >= tournament.slots) {
      throw new Error('Turniir on täis.');
    }
    if (user.balance < tournament.entryFee) {
      throw new Error('Sul pole piisavalt saldo turniiriga liitumiseks.');
    }
    tournament.participants.add(user.id);
    user.balance -= tournament.entryFee;
    user.stats.totalWagered += tournament.entryFee;
    user.updatedAt = Date.now();

    const announcement = {
      id: randomUUID(),
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      message: `${user.username} liitus turniiriga ${tournament.title}!`,
      createdAt: Date.now(),
      tone: 'system',
    };
    this.chatMessages.push(announcement);
    this._trimChat();

    return this._publicTournament(tournament, user.id);
  }

  listChatMessages(token) {
    this._requireUserBySession(token);
    return {
      messages: this.chatMessages.slice(-CHAT_HISTORY_LIMIT).map((entry) => this._publicChatMessage(entry)),
    };
  }

  postChatMessage(token, message) {
    const user = this._requireUserBySession(token);
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      throw new Error('Sõnum ei või olla tühi.');
    }
    const entry = {
      id: randomUUID(),
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      message: text.slice(0, 280),
      createdAt: Date.now(),
      tone: 'chat',
    };
    this.chatMessages.push(entry);
    this._trimChat();
    user.updatedAt = entry.createdAt;
    return {
      messages: this.chatMessages.slice(-CHAT_HISTORY_LIMIT).map((item) => this._publicChatMessage(item)),
    };
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
