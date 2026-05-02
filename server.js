const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const Delaunator = require('d3-delaunay');
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
        { id: 1, name: 'Красная Империя', color: 0xb71c1c, flag: [0xcc0000, 0xffffff, 0x880000] },
        { id: 2, name: 'Свободные Штаты', color: 0x006064, flag: [0x005f73, 0x0a9396, 0x94d2bd] },
        { id: 3, name: 'Стальной Пакт', color: 0x4a148c, flag: [0x3c096c, 0x9d4edd, 0x1a0030] },
        { id: 4, name: 'Северная Уния', color: 0xe65100, flag: [0xffffff, 0xff9100, 0x333333] },
        { id: 5, name: 'Империя Солнца', color: 0x1b5e20, flag: [0x55a630, 0xffd700, 0x2d6a4f] },
        { id: 6, name: 'Золотая Орда', color: 0xf57f17, flag: [0xf57f17, 0xffd54f, 0x795548] },
        { id: 7, name: 'Морская Держава', color: 0x0d47a1, flag: [0x0d47a1, 0x90caf9, 0xffffff] },
        { id: 8, name: 'Пустынный Халифат', color: 0xa67c00, flag: [0x388e3c, 0xffffff, 0xa67c00] },
        { id: 9, name: 'Ледяной Предел', color: 0x546e7a, flag: [0x546e7a, 0xeceff1, 0x263238] },
        { id: 10, name: 'Тигровый Союз', color: 0x880e4f, flag: [0x880e4f, 0xff4081, 0x1a0011] },
        { id: 11, name: 'Речная Конфедерация', color: 0x33691e, flag: [0x33691e, 0x8bc34a, 0x795548] },
        { id: 12, name: 'Железный Трон', color: 0x37474f, flag: [0x37474f, 0xb0bec5, 0x000000] }
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
    // Используем ту же конфигурацию, что и в клиенте
    const CONFIG = {
        width: 700, 
        height: 550, 
        pointsCount: 4000,
        waterLevel: 0.22, 
        mountainLevel: 0.75,
        seed: game.id.hashCode() // Используем ID игры как seed для одинаковой карты
    };
    
    // Генерация одинаковой карты для всех игроков
    const regions = generateMapRegions(CONFIG);
    
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

// Генерация карты регионов (та же логика что в клиенте)
function generateMapRegions(CONFIG) {
    // Используем детерминированный random на основе seed
    let seed = CONFIG.seed || 12345;
    function seededRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }
    
    // Генерация точек для триангуляции
    const points = [];
    for (let i = 0; i < CONFIG.pointsCount; i++) {
        points.push([
            seededRandom() * CONFIG.width,
            seededRandom() * CONFIG.height
        ]);
    }
    
    // Создание регионов на основе триангуляции
    const regions = [];
    const delaunay = Delaunator.from(points);
    
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const triangle = [
            points[delaunay.triangles[i]],
            points[delaunay.triangles[i + 1]],
            points[delaunay.triangles[i + 2]]
        ];
        
        // Центр треугольника
        const cx = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
        const cy = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;
        
        // Высота на основе шума
        const height = seededRandom();
        
        regions.push({
            id: regions.length,
            polygon: triangle,
            cx: cx,
            cy: cy,
            height: height,
            isWater: height < CONFIG.waterLevel,
            isMountain: height > CONFIG.mountainLevel,
            country: null,
            economyLevel: Math.floor(seededRandom() * 3) + 1,
            isCity: seededRandom() > 0.8,
            isCapital: false
        });
    }
    
    return regions;
}

// Хеш-функция для строки
String.prototype.hashCode = function() {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
        const char = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
};

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
        if (!playerData || !playerData.gameId) return;
        
        const game = games.get(playerData.gameId);
        if (!game) return;
        
        const player = game.players.get(socket.id);
        if (!player) return;
        
        player.ready = data.ready;
        
        // Проверка, можно ли начать игру
        if (player.ready && game.players.size >= 2) {
            startGame(playerData.gameId);
        }
        
        // Обновление лобби
        io.to(playerData.gameId).emit('lobbyUpdate', {
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

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server ready`);
});
