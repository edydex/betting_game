// app.js - Main application file

const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');

// For Azure App Service (free tier), we'll use in-memory session storage
// In production, you'd want to use a more persistent store like Azure Storage or Cosmos DB
const app = express();
const port = process.env.PORT || 3000;

// Game state (in a real app, you'd store this in a database)
const games = {};

// Set up session middleware
app.use(session({
  secret: 'betting-game-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
    maxAge: 1000 * 60 * 60 // 1 hour
  }
}));

// Parse incoming request bodies
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Add CORS headers for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Set the view engine to ejs
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    user: req.session.user,
    error: req.session.error 
  });
  // Clear any error messages after displaying them
  delete req.session.error;
});

// Helper function to determine total rounds based on player count
function getTotalRoundsForPlayerCount(playerCount) {
  if (playerCount <= 2) {
    return 5;
  } else if (playerCount === 3) {
    return 7;
  } else {
    return 9;  // 4+ players
  }
}

// Create a new game
app.post('/game/create', (req, res) => {
  const gameId = generateGameId();
  const username = req.body.username;
  const gameMode = req.body.gameMode || 'all-pay'; // Default to all-pay if not specified
  
  console.log(`Creating new game ${gameId} for user ${username}, mode: ${gameMode}`);
  
  if (!username || username.trim() === '') {
    req.session.error = 'Please enter a username';
    return res.redirect('/');
  }

  // Create a timestamp for the game
  const createdAt = Date.now();

  // Start with 1 player (the host)
  const initialRounds = getTotalRoundsForPlayerCount(1);

  games[gameId] = {
    id: gameId,
    createdAt: createdAt,
    gameMode: gameMode, // Add game mode to the game state
    players: [{
      id: generatePlayerId(),
      name: username,
      money: 100,
      roundsWon: 0,
      host: true
    }],
    currentRound: 0,
    totalRounds: initialRounds,
    roundsToWin: 3,
    status: 'waiting', // waiting, betting, roundComplete, gameComplete
    bets: {},
    roundWinner: null
  };

  req.session.user = {
    gameId: gameId,
    playerId: games[gameId].players[0].id,
    name: username
  };

  console.log(`Game ${gameId} created successfully, redirecting to game page`);
  res.redirect(`/game/${gameId}`);
});

// Join an existing game
app.post('/game/join', (req, res) => {
  let gameId = req.body.gameId;
  const username = req.body.username;
  
  // Normalize the game ID to uppercase for comparison
  if (gameId) {
    gameId = gameId.toUpperCase();
  }
  
  console.log(`User ${username} attempting to join game ${gameId}`);
  
  if (!username || username.trim() === '') {
    req.session.error = 'Please enter a username';
    return res.redirect('/');
  }
  
  if (!gameId || !games[gameId]) {
    console.log(`Game ${gameId} not found`);
    req.session.error = 'Game not found';
    return res.redirect('/');
  }
  
  const game = games[gameId];
  
  console.log(`Game ${gameId} status: ${game.status}, current players: ${game.players.length}, mode: ${game.gameMode}`);
  
  if (game.status !== 'waiting') {
    console.log(`Game ${gameId} has already started`);
    req.session.error = 'Game has already started';
    return res.redirect('/');
  }
  
  // Check if the username is already taken in this game
  if (game.players.some(p => p.name === username)) {
    console.log(`Username ${username} already taken in game ${gameId}`);
    req.session.error = 'Username already taken in this game';
    return res.redirect('/');
  }
  
  const newPlayer = {
    id: generatePlayerId(),
    name: username,
    money: 100,
    roundsWon: 0,
    host: false
  };
  
  game.players.push(newPlayer);
  
  // Update total rounds based on new player count
  game.totalRounds = getTotalRoundsForPlayerCount(game.players.length);
  console.log(`Updated total rounds to ${game.totalRounds} for game ${gameId} with ${game.players.length} players`);
  
  console.log(`User ${username} successfully joined game ${gameId}`);
  
  req.session.user = {
    gameId: gameId,
    playerId: newPlayer.id,
    name: username
  };
  
  res.redirect(`/game/${gameId}`);
});

// Game page
app.get('/game/:gameId', (req, res) => {
  const gameId = req.params.gameId;
  const user = req.session.user;
  
  console.log(`Loading game page for game ${gameId}, user:`, user ? user.name : 'unknown');
  
  if (!games[gameId]) {
    console.log(`Game ${gameId} not found when loading game page`);
    req.session.error = 'Game not found';
    return res.redirect('/');
  }
  
  if (!user || user.gameId !== gameId) {
    console.log(`User not in game ${gameId} when loading game page`);
    req.session.error = 'You are not in this game';
    return res.redirect('/');
  }
  
  const game = games[gameId];
  const player = game.players.find(p => p.id === user.playerId);
  
  if (!player) {
    console.log(`Player not found in game ${gameId} when loading game page`);
    req.session.error = 'Player not found';
    return res.redirect('/');
  }
  
  console.log(`Rendering game page for ${gameId}, status: ${game.status}, players: ${game.players.length}, mode: ${game.gameMode}`);
  
  res.render('game', { 
    game: game, 
    player: player,
    error: req.session.error 
  });
  
  // Clear any error messages after displaying them
  delete req.session.error;
});

// Start game
app.post('/game/:gameId/start', (req, res) => {
  const gameId = req.params.gameId;
  const user = req.session.user;
  
  console.log(`Starting game ${gameId}, user:`, user ? user.name : 'unknown');
  
  if (!games[gameId]) {
    console.log(`Game ${gameId} not found when starting game`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (!user || user.gameId !== gameId) {
    console.log(`User not in game ${gameId} when starting game`);
    return res.status(403).json({ error: 'You are not in this game' });
  }
  
  const game = games[gameId];
  console.log(`Game status: ${game.status}, players:`, game.players.length);
  
  const player = game.players.find(p => p.id === user.playerId);
  
  if (!player || !player.host) {
    console.log(`Player is not host when starting game ${gameId}`);
    return res.status(403).json({ error: 'Only the host can start the game' });
  }
  
  if (game.players.length < 2) {
    console.log(`Not enough players (${game.players.length}) to start game ${gameId}`);
    return res.status(400).json({ error: 'Need at least 2 players to start' });
  }
  
  if (game.status !== 'waiting') {
    console.log(`Game ${gameId} already started: ${game.status}`);
    return res.status(400).json({ error: 'Game has already started' });
  }
  
  // Start the first round
  game.status = 'betting';
  game.currentRound = 1;
  game.bets = {};
  
  console.log(`Game ${gameId} started successfully`);
  res.json({ success: true });
});

// Place bet
app.post('/game/:gameId/bet', (req, res) => {
  const gameId = req.params.gameId;
  const user = req.session.user;
  const betAmount = parseInt(req.body.amount, 10);
  
  console.log(`Player ${user ? user.name : 'unknown'} placing bet ${betAmount} in game ${gameId}`);
  
  if (!games[gameId]) {
    console.log(`Game ${gameId} not found when placing bet`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (!user || user.gameId !== gameId) {
    console.log(`User not in game ${gameId} when placing bet`);
    return res.status(403).json({ error: 'You are not in this game' });
  }
  
  const game = games[gameId];
  const player = game.players.find(p => p.id === user.playerId);
  
  if (!player) {
    console.log(`Player not found in game ${gameId} when placing bet`);
    return res.status(404).json({ error: 'Player not found' });
  }
  
  if (game.status !== 'betting') {
    console.log(`Game ${gameId} status ${game.status} not in betting phase`);
    return res.status(400).json({ error: 'It is not betting time' });
  }
  
  if (game.bets[player.id] !== undefined) {
    console.log(`Player ${player.name} already bet in round ${game.currentRound}`);
    return res.status(400).json({ error: 'You have already placed a bet this round' });
  }
  
  if (isNaN(betAmount) || betAmount < 0 || betAmount > player.money) {
    console.log(`Invalid bet amount ${betAmount} from player ${player.name}`);
    return res.status(400).json({ error: 'Invalid bet amount' });
  }
  
  // Place the bet
  game.bets[player.id] = betAmount;
  console.log(`Player ${player.name} bet ${betAmount} in game ${gameId}`);
  
  // Check if all players have bet
  const allPlayersHaveBet = game.players.every(p => game.bets[p.id] !== undefined);
  
  if (allPlayersHaveBet) {
    console.log(`All players have bet in game ${gameId}, completing round ${game.currentRound}`);
    // Complete the round
    completeRound(game);
  }
  
  res.json({ success: true });
});

// Next round
app.post('/game/:gameId/nextround', (req, res) => {
  const gameId = req.params.gameId;
  const user = req.session.user;
  
  console.log(`Starting next round in game ${gameId}, user:`, user ? user.name : 'unknown');
  
  if (!games[gameId]) {
    console.log(`Game ${gameId} not found when advancing round`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (!user || user.gameId !== gameId) {
    console.log(`User not in game ${gameId} when advancing round`);
    return res.status(403).json({ error: 'You are not in this game' });
  }
  
  const game = games[gameId];
  const player = game.players.find(p => p.id === user.playerId);
  
  if (!player || !player.host) {
    console.log(`Player is not host when advancing round in game ${gameId}`);
    return res.status(403).json({ error: 'Only the host can advance to the next round' });
  }
  
  if (game.status !== 'roundComplete') {
    console.log(`Game ${gameId} status ${game.status} is not roundComplete`);
    return res.status(400).json({ error: 'Cannot start next round yet' });
  }
  
  // Check if the game is over based on game mode
  if (shouldEndGame(game)) {
    console.log(`Game ${gameId} complete after ${game.currentRound} rounds`);
    game.status = 'gameComplete';
    
    // Determine the overall winner
    determineOverallWinner(game);
    
    return res.json({ success: true, gameComplete: true });
  }
  
  // Start the next round
  game.currentRound++;
  game.status = 'betting';
  game.bets = {};
  game.roundWinners = null;
  game.showRoundResults = false; // Hide round results
  
  console.log(`Game ${gameId} advanced to round ${game.currentRound}`);
  res.json({ success: true });
});

// Reset game
app.post('/game/:gameId/reset', (req, res) => {
  const gameId = req.params.gameId;
  const user = req.session.user;
  
  console.log(`Resetting game ${gameId}, user:`, user ? user.name : 'unknown');
  
  if (!games[gameId]) {
    console.log(`Game ${gameId} not found when resetting`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (!user || user.gameId !== gameId) {
    console.log(`User not in game ${gameId} when resetting`);
    return res.status(403).json({ error: 'You are not in this game' });
  }
  
  const game = games[gameId];
  const player = game.players.find(p => p.id === user.playerId);
  
  if (!player || !player.host) {
    console.log(`Player is not host when resetting game ${gameId}`);
    return res.status(403).json({ error: 'Only the host can reset the game' });
  }
  
  // Reset the game
  game.players.forEach(p => {
    p.money = 100;
    p.roundsWon = 0;
  });
  
  game.currentRound = 0;
  game.status = 'waiting';
  game.bets = {};
  game.roundWinners = null;
  game.overallWinner = null;
  game.lastRoundBets = {};
  game.showRoundResults = false;
  game.secondHighestBid = undefined;
  game.actualPayments = {};
  
  console.log(`Game ${gameId} reset successfully`);
  res.json({ success: true });
});

// Get game state (for polling updates)
app.get('/game/:gameId/state', (req, res) => {
  const gameId = req.params.gameId;
  const user = req.session.user;
  
  // Only log every 10th request to avoid flooding the logs
  const shouldLog = Math.random() < 0.1;
  if (shouldLog) {
    console.log(`Polling game state for game ${gameId}, user:`, user ? user.name : 'unknown');
  }
  
  if (!games[gameId]) {
    console.log(`Game ${gameId} not found during polling`);
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (!user || user.gameId !== gameId) {
    console.log(`User not in game ${gameId} during polling`);
    return res.status(403).json({ error: 'You are not in this game' });
  }
  
  const game = games[gameId];
  const player = game.players.find(p => p.id === user.playerId);
  
  if (!player) {
    console.log(`Player not found in game ${gameId} during polling`);
    return res.status(404).json({ error: 'Player not found' });
  }
  
  if (shouldLog) {
    console.log(`Game ${gameId} state: ${game.status}, players: ${game.players.length}, round: ${game.currentRound}`);
  }
  
  // Add a cache-control header to prevent caching
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Return the game state
  const gameState = {
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      money: p.money,
      roundsWon: p.roundsWon,
      host: p.host,
      hasBet: game.bets[p.id] !== undefined
    })),
    currentRound: game.currentRound,
    totalRounds: game.totalRounds,
    roundsToWin: game.roundsToWin,
    status: game.status,
    gameMode: game.gameMode,
    roundWinners: game.roundWinners,
    overallWinner: game.overallWinner ? {
      id: game.overallWinner.id,
      name: game.overallWinner.name,
      roundsWon: game.overallWinner.roundsWon,
      money: game.overallWinner.money
    } : null,
    myBet: game.bets[player.id],
    isMyTurn: game.status === 'betting' && game.bets[player.id] === undefined,
    amHost: player.host,
    lastRoundBets: game.lastRoundBets || {},
    showRoundResults: game.showRoundResults || false,
    secondHighestBid: game.secondHighestBid,
    actualPayments: game.actualPayments
  };
  
  // Return the game state
  res.json(gameState);
});

// Helper function to check if game should end
function shouldEndGame(game) {
  if (game.gameMode === 'all-pay') {
    // All-Pay mode: game ends if someone has 3+ wins or after all rounds
    return game.players.some(p => p.roundsWon >= game.roundsToWin) || game.currentRound >= game.totalRounds;
  } else {
    // Standard or Vickrey mode: game always runs all rounds
    return game.currentRound >= game.totalRounds;
  }
}

// Helper function to determine the overall winner
function determineOverallWinner(game) {
  if (game.gameMode === 'all-pay') {
    // All-Pay mode: check for 3 wins first
    const playerWith3Wins = game.players.find(p => p.roundsWon >= game.roundsToWin);
    
    if (playerWith3Wins) {
      // Someone has 3 or more wins, they're the winner
      console.log(`Game ${game.id} complete - ${playerWith3Wins.name} won with ${playerWith3Wins.roundsWon} rounds`);
      game.overallWinner = playerWith3Wins;
      return;
    }
  }
  
  // For all modes: if no player has 3 wins, determine by most wins then money
  // Find player(s) with most wins
  const maxWins = Math.max(...game.players.map(p => p.roundsWon));
  const playersWithMostWins = game.players.filter(p => p.roundsWon === maxWins);
  
  if (playersWithMostWins.length === 1) {
    // Only one player has the most wins
    game.overallWinner = playersWithMostWins[0];
    console.log(`${game.overallWinner.name} won with ${maxWins} wins and $${game.overallWinner.money}`);
  } else {
    // Multiple players tied for wins, determine by money
    const winnerByMoney = playersWithMostWins.reduce((prev, current) => 
      (prev.money > current.money) ? prev : current
    );
    game.overallWinner = winnerByMoney;
    console.log(`${game.overallWinner.name} won with ${maxWins} wins and $${game.overallWinner.money} (tiebreaker by money)`);
  }
}

// Helper function to complete a round
function completeRound(game) {
  console.log(`Completing round ${game.currentRound} for game ${game.id}, mode: ${game.gameMode}`);
  
  // Store last round's bets before updating money
  game.lastRoundBets = { ...game.bets };
  game.showRoundResults = true;
  
  // Set a timer to hide round results after 5 seconds
  setTimeout(() => {
    if (games[game.id]) {
      games[game.id].showRoundResults = false;
      console.log(`Round results hidden for game ${game.id}`);
    }
  }, 5000);
  
  // Find the highest and second highest bids
  let bids = Object.entries(game.bets)
    .map(([playerId, amount]) => ({ playerId, amount }))
    .sort((a, b) => b.amount - a.amount); // Sort by amount descending
  
  if (bids.length === 0) {
    console.log(`No bids placed in round ${game.currentRound}`);
    game.status = 'roundComplete';
    game.roundWinners = [];
    return;
  }
  
  const highestBid = bids[0].amount;
  const highestBidders = bids.filter(bid => bid.amount === highestBid).map(bid => bid.playerId);
  
  // Find second highest bid (for Vickrey)
  let secondHighestBid = bids.length > 1 ? bids.find(bid => bid.amount < highestBid)?.amount : undefined;
  game.secondHighestBid = secondHighestBid;
  
  // Find third highest bid (for Vickrey ties)
  let thirdHighestBid;
  if (bids.length > 2 && highestBidders.length > 1) {
    // When there's a tie for highest, we need to find the next highest after the tied players
    const nonWinnerBids = bids.filter(bid => !highestBidders.includes(bid.playerId));
    thirdHighestBid = nonWinnerBids.length > 0 ? nonWinnerBids[0].amount : undefined;
  }
  game.thirdHighestBid = thirdHighestBid;
  
  // Store actual payments
  game.actualPayments = {};
  
  // Calculate fractional win amount based on number of winners
  const fractionalWinAmount = getFractionalWinAmount(highestBidders.length);
  
  // Update player balances and determine winners based on game mode
  if (game.gameMode === 'all-pay') {
    // All-Pay auction: all players pay their bids
    game.players.forEach(player => {
      const betAmount = game.bets[player.id] || 0;
      player.money -= betAmount;
      game.actualPayments[player.id] = betAmount;
    });
    
    // Single winner
    if (highestBidders.length === 1) {
      const winner = game.players.find(p => p.id === highestBidders[0]);
      winner.roundsWon += 1; // Full win
      console.log(`Player ${winner.name} won round ${game.currentRound} with bet of ${highestBid}`);
    } 
    // Multiple winners (tie)
    else if (highestBidders.length > 1) {
      highestBidders.forEach(winnerId => {
        const winner = game.players.find(p => p.id === winnerId);
        winner.roundsWon += fractionalWinAmount; // Fractional win
        console.log(`Player ${winner.name} tied for win in round ${game.currentRound} with bet of ${highestBid}, gets ${fractionalWinAmount} wins`);
      });
    }
  } 
  else if (game.gameMode === 'standard') {
    // Standard auction: only the winner pays their bid
    game.players.forEach(player => {
      // By default, no one pays anything
      game.actualPayments[player.id] = 0;
    });
    
    // Single winner
    if (highestBidders.length === 1) {
      const winner = game.players.find(p => p.id === highestBidders[0]);
      
      // Winner pays their bid amount
      winner.money -= highestBid;
      game.actualPayments[winner.id] = highestBid;
      
      winner.roundsWon += 1; // Full win
      console.log(`Player ${winner.name} won round ${game.currentRound} with bet of ${highestBid}, pays ${highestBid}`);
    } 
    // Multiple winners (tie)
    else if (highestBidders.length > 1) {
      highestBidders.forEach(winnerId => {
        const winner = game.players.find(p => p.id === winnerId);
        
        // In case of a tie, each winner pays their full bid
        winner.money -= highestBid;
        game.actualPayments[winner.id] = highestBid;
        
        winner.roundsWon += fractionalWinAmount; // Fractional win
        console.log(`Player ${winner.name} tied for win in round ${game.currentRound} with bet of ${highestBid}, gets ${fractionalWinAmount} wins, pays ${highestBid}`);
      });
    }
  }
  else {
    // Vickrey mode: payment logic for winners
    game.players.forEach(player => {
      // By default, no one pays anything
      game.actualPayments[player.id] = 0;
    });
    
    // Single winner
    if (highestBidders.length === 1) {
      const winner = game.players.find(p => p.id === highestBidders[0]);
      
      // Winner pays second highest bid, or their own bid if they're the only bidder
      const payment = secondHighestBid !== undefined ? secondHighestBid : highestBid;
      winner.money -= payment;
      game.actualPayments[winner.id] = payment;
      
      winner.roundsWon += 1; // Full win
      console.log(`Player ${winner.name} won round ${game.currentRound} with bet of ${highestBid}, pays ${payment}`);
    } 
    // Multiple winners (tie)
    else if (highestBidders.length > 1) {
      // In ties, winners each get fractional win and pay the third highest bid amount
      // If no third highest (everyone tied for highest or only 2 bids total),
      // they pay the second highest bid amount
      const payment = thirdHighestBid !== undefined ? thirdHighestBid : 
                     (secondHighestBid !== undefined ? secondHighestBid : 0);
      
      highestBidders.forEach(winnerId => {
        const winner = game.players.find(p => p.id === winnerId);
        winner.money -= payment;
        game.actualPayments[winner.id] = payment;
        winner.roundsWon += fractionalWinAmount; // Fractional win
        console.log(`Player ${winner.name} tied for win in round ${game.currentRound} with bet of ${highestBid}, gets ${fractionalWinAmount} wins, pays ${payment}`);
      });
    }
  }
  
  // Store the round winners
  game.roundWinners = highestBidders;
  
  // Update game status
  game.status = 'roundComplete';
  
  // Check if the game is over
  if (shouldEndGame(game)) {
    console.log(`Game ${game.id} complete after ${game.currentRound} rounds`);
    game.status = 'gameComplete';
    
    // Determine the overall winner
    determineOverallWinner(game);
  }
}

// Helper function to calculate fractional win amount based on number of winners
function getFractionalWinAmount(numWinners) {
  if (numWinners <= 1) return 1;  // Solo winner gets full point
  
  switch(numWinners) {
    case 2: return 0.5;  // Two-way tie
    case 3: return 0.4;  // Three-way tie
    case 4: return 0.3;  // Four-way tie
    default: return 0.2; // Five or more
  }
}

// Helper functions to generate unique IDs
function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePlayerId() {
  return Math.random().toString(36).substring(2, 10);
}

app.listen(port, () => {
  console.log(`Betting game app listening at http://localhost:${port}`);
});

// Clean up inactive games (in a real app, you'd use a more robust cleanup mechanism)
setInterval(() => {
  const now = Date.now();
  let removedCount = 0;
  
  for (const gameId in games) {
    // Remove games older than 24 hours
    if (games[gameId].createdAt && now - games[gameId].createdAt > 24 * 60 * 60 * 1000) {
      delete games[gameId];
      removedCount++;
    }
  }
  
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} inactive games`);
  }
}, 60 * 60 * 1000); // Check every hour

module.exports = app;