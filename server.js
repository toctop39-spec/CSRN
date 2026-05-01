const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Игровые состояния
const games = new Map(); // gameId -> game state
const players = new Map(); // socketId -> player data
const gameRooms = new Map(); // roomId -> Set of socketIds

// Конфигурация игры
const CONFIG = {
    MAX_PLAYERS_PER_GAME: 8,
    GAME_SPEED: 1000, // 1 секунда на тик
    SYNC_INTERVAL: 100, // 100ms для синхронизации
};

// Инициализация базовой конфигурации
const baseGameConfig = {
    countries: [
        { id: 'russia', name: 'Россия', color: 0x0052cc, flag: [0x0052cc, 0xffffff, 0x0052cc] },
        { id: 'germany', name: 'Германия', color: 0x000000, flag: [0x000000, 0xff0000, 0xffcc00] },
        { id: 'france', name: 'Франция', color: 0x0055a4, flag: [0x0055a4, 0xffffff, 0xef4135] },
        { id: 'britain', name: 'Британия', color: 0xcf142b, flag: [0xcf142b, 0xffffff, 0xcf142b] },
        { id: 'italy', name: 'Италия', color: 0x009246, flag: [0x009246, 0xffffff, 0xce2b37] },
        { id: 'spain', name: 'Испания', color: 0xaa151b, flag: [0xaa151b, 0xffc400, 0xaa151b] },
        { id: 'poland', name: 'Польша', color: 0xffffff, flag: [0xffffff, 0xdc143c, 0xffffff] },
        { id: 'turkey', name: 'Турция', color: 0xe30a17, flag: [0xe30a17, 0xffffff, 0xe30a17] }
    ]
};

// Создание новой игры
function createGame(gameId, creatorId) {
    const game = {
        id: gameId,
        players: new Map(),
        status: 'waiting', // waiting, playing, finished
        startTime: null,
        currentTick: 0,
        regions: [],
        armies: [],
        diplomaticRelations: {},
        gameSpeed: 1,
        lastSync: Date.now()
    };
    
    games.set(gameId, game);
    return game;
}

// Присоединение игрока к игре
function joinGame(socket, gameId, playerName, countryId) {
    const game = games.get(gameId);
    if (!game) {
        socket.emit('error', { message: 'Игра не найдена' });
        return false;
    }
    
    if (game.players.size >= CONFIG.MAX_PLAYERS_PER_GAME) {
        socket.emit('error', { message: 'Игра заполнена' });
        return false;
    }
    
    if (game.status !== 'waiting') {
        socket.emit('error', { message: 'Игра уже началась' });
        return false;
    }
    
    // Проверка, не занята ли страна
    const countryOccupied = Array.from(game.players.values()).some(p => p.country.id === countryId);
    if (countryOccupied) {
        socket.emit('error', { message: 'Страна уже занята' });
        return false;
    }
    
    const country = baseGameConfig.countries.find(c => c.id === countryId);
    if (!country) {
        socket.emit('error', { message: 'Страна не найдена' });
        return false;
    }
    
    const player = {
        id: socket.id,
        name: playerName,
        country: country,
        ready: false,
        joinedAt: Date.now()
    };
    
    game.players.set(socket.id, player);
    players.set(socket.id, { gameId, player });
    
    socket.join(gameId);
    
    // Отправка обновления всем игрокам в лобби
    io.to(gameId).emit('lobbyUpdate', {
        players: Array.from(game.players.values()),
        status: game.status
    });
    
    return true;
}

// Начало игры
function startGame(gameId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'waiting') return false;
    
    // Проверка готовности всех игроков
    const allReady = Array.from(game.players.values()).every(p => p.ready);
    if (!allReady) return false;
    
    game.status = 'playing';
    game.startTime = Date.now();
    
    // Инициализация игровых данных
    initializeGameData(game);
    
    // Запуск игрового цикла
    startGameLoop(gameId);
    
    io.to(gameId).emit('gameStart', {
        gameId: gameId,
        players: Array.from(game.players.values()),
        initialData: {
            regions: game.regions,
            armies: game.armies,
            diplomaticRelations: game.diplomaticRelations
        }
    });
    
    return true;
}

// Инициализация игровых данных
function initializeGameData(game) {
    // Генерация регионов (упрощенная версия)
    const regions = [];
    const regionCount = 50;
    
    for (let i = 0; i < regionCount; i++) {
        const region = {
            id: i,
            name: `Регион ${i + 1}`,
            country: null,
            isCity: Math.random() > 0.7,
            isCapital: false,
            economyLevel: Math.floor(Math.random() * 3) + 1,
            height: Math.random() * 2,
            biome: ['plains', 'forest', 'mountain', 'desert'][Math.floor(Math.random() * 4)],
            polygon: generatePolygon(6, 50),
            cx: Math.random() * 200 - 100,
            cz: Math.random() * 200 - 100
        };
        regions.push(region);
    }
    
    // Распределение стартовых регионов игрокам
    const playerCountries = Array.from(game.players.values()).map(p => p.country.id);
    let regionIndex = 0;
    
    playerCountries.forEach(countryId => {
        // Даем каждому игроку по 3-4 стартовых региона
        const startRegions = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < startRegions && regionIndex < regions.length; i++) {
            regions[regionIndex].country = countryId;
            if (i === 0) {
                regions[regionIndex].isCapital = true;
                regions[regionIndex].economyLevel = 3;
            }
            regionIndex++;
        }
    });
    
    game.regions = regions;
    game.armies = [];
    
    // Инициализация дипломатии
    playerCountries.forEach(countryId => {
        game.diplomaticRelations[countryId] = {};
        playerCountries.forEach(otherCountryId => {
            if (countryId !== otherCountryId) {
                game.diplomaticRelations[countryId][otherCountryId] = {
                    status: 'peace',
                    justificationProgress: 0,
                    isJustifying: false
                };
            }
        });
    });
}

// Генерация полигона региона
function generatePolygon(sides, radius) {
    const polygon = [];
    for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const r = radius * (0.8 + Math.random() * 0.4);
        polygon.push([
            Math.cos(angle) * r,
            Math.sin(angle) * r
        ]);
    }
    return polygon;
}

// Игровой цикл
function startGameLoop(gameId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return;
    
    const gameLoop = setInterval(() => {
        if (game.status !== 'playing') {
            clearInterval(gameLoop);
            return;
        }
        
        game.currentTick++;
        processGameTick(game);
        
        // Синхронизация с клиентами
        if (Date.now() - game.lastSync >= CONFIG.SYNC_INTERVAL) {
            syncGameState(game);
            game.lastSync = Date.now();
        }
    }, CONFIG.GAME_SPEED / game.gameSpeed);
}

// Обработка одного тика игры
function processGameTick(game) {
    // Обработка экономики
    processEconomy(game);
    
    // Обработка движения армий
    processArmiesMovement(game);
    
    // Обработка боев
    processCombat(game);
    
    // Обработка исследований
    processResearch(game);
}

// Обработка экономики
function processEconomy(game) {
    const playerStats = {};
    
    // Инициализация статистики игроков
    Array.from(game.players.values()).forEach(player => {
        playerStats[player.country.id] = {
            money: 1000,
            manpower: 500,
            politicalPower: 50,
            income: 0,
            upkeep: 0
        };
    });
    
    // Расчет дохода от регионов
    game.regions.forEach(region => {
        const owner = region.country;
        if (owner && playerStats[owner]) {
            const income = region.isCity ? 50 : 20;
            const factoryIncome = (region.economyLevel - 1) * 90;
            playerStats[owner].income += income + factoryIncome;
            playerStats[owner].money += income + factoryIncome;
        }
    });
    
    // Расчет содержания армий
    game.armies.forEach(army => {
        const owner = army.country;
        if (owner && playerStats[owner]) {
            const upkeep = army.type === 'tank' ? 10 : 5;
            playerStats[owner].upkeep += upkeep;
            playerStats[owner].money -= upkeep;
        }
    });
    
    // Прирост политической власти и маны
    Object.keys(playerStats).forEach(countryId => {
        playerStats[countryId].politicalPower += 2.5;
        playerStats[countryId].manpower += 10;
    });
}

// Синхронизация состояния игры с клиентами
function syncGameState(game) {
    const gameState = {
        tick: game.currentTick,
        regions: game.regions,
        armies: game.armies,
        diplomaticRelations: game.diplomaticRelations,
        playerStats: calculatePlayerStats(game)
    };
    
    io.to(game.id).emit('gameSync', gameState);
}

// Расчет статистики игроков
function calculatePlayerStats(game) {
    const stats = {};
    
    Array.from(game.players.values()).forEach(player => {
        const countryId = player.country.id;
        const regions = game.regions.filter(r => r.country === countryId);
        const armies = game.armies.filter(a => a.country === countryId);
        
        stats[countryId] = {
            money: 1000 + regions.reduce((sum, r) => sum + (r.isCity ? 50 : 20) + (r.economyLevel - 1) * 90, 0),
            manpower: 500 + regions.length * 10,
            politicalPower: 50,
            regions: regions.length,
            armies: armies.length
        };
    });
    
    return stats;
}

// Обработка движения армий
function processArmiesMovement(game) {
    game.armies.forEach(army => {
        if (army.path && army.path.length > 0 && army.state === 'MOVING') {
            army.progress += 0.1; // 10% за тик
            
            if (army.progress >= 1) {
                // Армия достигла цели
                const targetRegion = game.regions.find(r => r.id === army.path[0]);
                if (targetRegion) {
                    army.region = targetRegion;
                    army.state = 'IDLE';
                    army.path = [];
                    army.progress = 0;
                }
            }
        }
    });
}

// Обработка боев
function processCombat(game) {
    // Упрощенная обработка боев
    const combats = [];
    
    game.armies.forEach(army => {
        if (army.state === 'COMBAT') {
            // Логика боя
            army.strength *= 0.95; // Потери в бою
            
            if (army.strength < 0.1) {
                // Армия уничтожена
                const index = game.armies.indexOf(army);
                if (index > -1) {
                    game.armies.splice(index, 1);
                }
            }
        }
    });
}

// Обработка исследований
function processResearch(game) {
    // Упрощенная обработка исследований
    Array.from(game.players.values()).forEach(player => {
        if (player.researchProgress) {
            player.researchProgress += 0.05;
            
            if (player.researchProgress >= 1) {
                player.researchProgress = 0;
                player.currentTech = null;
                // Применение эффектов технологии
            }
        }
    });
}

// WebSocket обработчики
io.on('connection', (socket) => {
    console.log(`Игрок подключен: ${socket.id}`);
    
    // Создание новой игры
    socket.on('createGame', (data) => {
        const gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const game = createGame(gameId, socket.id);
        
        socket.emit('gameCreated', { gameId });
        socket.join(gameId);
    });
    
    // Присоединение к игре
    socket.on('joinGame', (data) => {
        const { gameId, playerName, countryId } = data;
        joinGame(socket, gameId, playerName, countryId);
    });
    
    // Получение списка игр
    socket.on('getGames', () => {
        const availableGames = Array.from(games.values())
            .filter(game => game.status === 'waiting')
            .map(game => ({
                id: game.id,
                players: game.players.size,
                maxPlayers: CONFIG.MAX_PLAYERS_PER_GAME,
                status: game.status
            }));
        
        socket.emit('gamesList', availableGames);
    });
    
    // Готовность игрока
    socket.on('playerReady', (data) => {
        const playerData = players.get(socket.id);
        if (!playerData) return;
        
        const { game, player } = playerData;
        player.ready = data.ready;
        
        // Проверка, можно ли начать игру
        if (player.ready && game.players.size >= 2) {
            startGame(game.id);
        }
        
        // Обновление лобби
        io.to(game.id).emit('lobbyUpdate', {
            players: Array.from(game.players.values()),
            status: game.status
        });
    });
    
    // Игровые действия
    socket.on('gameAction', (data) => {
        const playerData = players.get(socket.id);
        if (!playerData || playerData.game.status !== 'playing') return;
        
        handleGameAction(playerData.game, playerData.player, data);
    });
    
    // Отключение игрока
    socket.on('disconnect', () => {
        console.log(`Игрок отключен: ${socket.id}`);
        
        const playerData = players.get(socket.id);
        if (playerData) {
            const { game, player } = playerData;
            
            game.players.delete(socket.id);
            players.delete(socket.id);
            
            // Если игра пуста, удаляем ее
            if (game.players.size === 0) {
                games.delete(game.id);
            } else {
                // Обновляем лобби
                io.to(game.id).emit('lobbyUpdate', {
                    players: Array.from(game.players.values()),
                    status: game.status
                });
            }
        }
    });
});

// Обработка игровых действий
function handleGameAction(game, player, action) {
    switch (action.type) {
        case 'moveArmy':
            handleMoveArmy(game, player, action.data);
            break;
        case 'buildFactory':
            handleBuildFactory(game, player, action.data);
            break;
        case 'researchTech':
            handleResearchTech(game, player, action.data);
            break;
        case 'diplomacy':
            handleDiplomacy(game, player, action.data);
            break;
    }
}

// Обработка движения армии
function handleMoveArmy(game, player, data) {
    const { armyId, targetRegion } = data;
    const army = game.armies.find(a => a.id === armyId && a.country === player.country.id);
    
    if (army && army.state === 'IDLE') {
        army.path = [targetRegion];
        army.state = 'MOVING';
        army.progress = 0;
    }
}

// Обработка строительства завода
function handleBuildFactory(game, player, data) {
    const { regionId } = data;
    const region = game.regions.find(r => r.id === regionId && r.country === player.country.id);
    
    if (region && region.isCity && region.economyLevel < 5) {
        region.economyLevel++;
    }
}

// Обследование исследования
function handleResearchTech(game, player, data) {
    const { techId } = data;
    player.currentTech = techId;
    player.researchProgress = 0;
}

// Обработка дипломатии
function handleDiplomacy(game, player, data) {
    const { targetCountry, action } = data;
    const relations = game.diplomaticRelations[player.country.id][targetCountry];
    
    switch (action) {
        case 'declareWar':
            relations.status = 'war';
            break;
        case 'offerPeace':
            relations.status = 'peace';
            break;
        case 'justifyWar':
            relations.isJustifying = true;
            relations.justificationProgress = 0;
            break;
    }
}

// API эндпоинты
app.get('/api/games', (req, res) => {
    const availableGames = Array.from(games.values())
        .filter(game => game.status === 'waiting')
        .map(game => ({
            id: game.id,
            players: game.players.size,
            maxPlayers: CONFIG.MAX_PLAYERS_PER_GAME,
            status: game.status
        }));
    
    res.json(availableGames);
});

app.get('/api/game/:id', (req, res) => {
    const game = games.get(req.params.id);
    if (!game) {
        return res.status(404).json({ error: 'Игра не найдена' });
    }
    
    res.json({
        id: game.id,
        status: game.status,
        players: Array.from(game.players.values()),
        currentTick: game.currentTick
    });
});

// Обслуживание статических файлов
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'CSRN.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`URL: http://localhost:${PORT}`);
});
