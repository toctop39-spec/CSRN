// Мультиплеер клиент для CSRN
class MultiplayerClient {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerId = null;
        this.isConnected = false;
        this.gameState = null;
        this.playerData = null;
        this.callbacks = {};
        
        // Конфигурация
        this.serverUrl = "https://csrn.onrender.com";
        // this.serverUrl = 'https://your-app.onrender.com'; // Для production
    }
    
    // Настройка обработчиков событий
    setupEventHandlers() {
        // Этот метод будет вызываться после создания socket соединения
    }
    
    // Подключение к серверу
    connect() {
        if (this.socket && this.socket.connected) {
            console.log('Уже подключены к серверу');
            return;
        }
        
        console.log('Подключение к серверу:', this.serverUrl);
        this.socket = io(this.serverUrl, {
            transports: ['websocket', 'polling']
        });
        
        this.setupSocketEventHandlers();
    }
    
    // Настройка обработчиков событий сокета
    setupSocketEventHandlers() {
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.playerId = this.socket.id;
            console.log('Подключено к серверу с ID:', this.playerId);
            this.trigger('connected');
        });
        
        this.socket.on('disconnect', () => {
            this.isConnected = false;
            console.log('Отключено от сервера');
            this.trigger('disconnected');
        });
        
        this.socket.on('error', (error) => {
            console.error('Ошибка сокета:', error);
            this.trigger('error', error);
        });
        
        // Игровые события
        this.socket.on('gameCreated', (data) => {
            this.gameId = data.gameId;
            console.log('Игра создана:', this.gameId);
            this.trigger('gameCreated', data);
        });
        
        this.socket.on('lobbyUpdate', (data) => {
            console.log('Обновление лобби:', data);
            this.trigger('lobbyUpdate', data);
        });
        
        this.socket.on('gameStart', (data) => {
            console.log('Игра началась:', data);
            this.gameState = data.initialData;
            this.trigger('gameStart', data);
        });
        
        this.socket.on('gameSync', (data) => {
            this.gameState = data;
            this.trigger('gameSync', data);
        });
        
        this.socket.on('gamesList', (data) => {
            console.log('Список игр:', data);
            this.trigger('gamesList', data);
        });
    }
    
    // Создание новой игры
    createGame() {
        if (!this.isConnected) {
            console.error('Не подключено к серверу');
            return;
        }
        
        this.socket.emit('createGame');
    }
    
    // Присоединение к игре
    joinGame(gameId, playerName, countryId) {
        if (!this.isConnected) {
            console.error('Не подключено к серверу');
            return false;
        }
        
        console.log('Присоединение к игре:', gameId, playerName, countryId);
        this.socket.emit('joinGame', { gameId, playerName, countryId });
        return true;
    }
    
    // Получение списка игр
    getGamesList() {
        if (!this.isConnected) {
            console.error('Не подключено к серверу');
            return;
        }
        
        this.socket.emit('getGames');
    }
    
    // Установка готовности
    setPlayerReady(ready) {
        if (!this.isConnected) {
            console.error('Не подключено к серверу');
            return;
        }
        
        this.socket.emit('playerReady', { ready });
    }
    
    // Отправка игрового действия
    sendGameAction(action, data) {
        if (!this.isConnected) {
            console.error('Не подключено к серверу');
            return;
        }
        
        this.socket.emit('gameAction', { type: action, data });
    }
    
    // Отключение
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.gameId = null;
        this.playerId = null;
    }
    
    // Регистрация обработчиков событий
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }
    
    // Удаление обработчика
    off(event, callback) {
        if (this.callbacks[event]) {
            const index = this.callbacks[event].indexOf(callback);
            if (index > -1) {
                this.callbacks[event].splice(index, 1);
            }
        }
    }
    
    // Вызов обработчиков
    trigger(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => callback(data));
        }
    }
    
    // Получение текущего состояния игры
    getGameState() {
        return this.gameState;
    }
    
    // Получение данных игрока
    getPlayerData() {
        return this.playerData;
    }
    
    // Проверка подключения
    isOnline() {
        return this.isConnected;
    }
}

// Интеграция с существующей игрой
class MultiplayerIntegration {
    constructor() {
        this.client = new MultiplayerClient();
        this.isMultiplayer = false;
        this.currentGameId = null;
        this.setupUI();
        this.setupEventHandlers();
    }
    
    // Настройка UI элементов
    setupUI() {
        // Создание мультиплеер меню
        const multiplayerHTML = `
            <div id="multiplayer-menu" class="hoi-panel" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:1000; min-width:400px;">
                <div class="hoi-corner-tl"></div><div class="hoi-corner-tr"></div>
                <div class="hoi-corner-bl"></div><div class="hoi-corner-br"></div>
                
                <div class="ap-header">
                    <div class="ap-title">Мультиплеер</div>
                </div>
                
                <div class="ap-body">
                    <div id="mp-connection-status">
                        <div class="mp-status">Статус: <span id="mp-connection-text">Отключено</span></div>
                        <button id="mp-connect-btn" class="hoi-btn btn-gold">Подключиться</button>
                    </div>
                    
                    <div id="mp-game-list" style="display:none;">
                        <h3>Доступные игры</h3>
                        <div id="mp-games-container"></div>
                        <button id="mp-create-game-btn" class="hoi-btn btn-gold">Создать игру</button>
                    </div>
                    
                    <div id="mp-lobby" style="display:none;">
                        <h3>Лобби игры</h3>
                        <div id="mp-players-list"></div>
                        <div id="mp-country-selection">
                            <h4>Выберите страну:</h4>
                            <div id="mp-countries-grid"></div>
                        </div>
                        <div id="mp-ready-section" style="display:none;">
                            <button id="mp-ready-btn" class="hoi-btn btn-green">Я готов</button>
                        </div>
                    </div>
                </div>
                
                <button id="mp-close-btn" class="hoi-btn btn-red" style="position:absolute; top:10px; right:10px;">Закрыть</button>
            </div>
            
            <button id="mp-menu-btn" class="tb-btn" style="display:none;">🌐 Мультиплеер</button>
        `;
        
        document.body.insertAdjacentHTML('beforeend', multiplayerHTML);
        this.bindUIEvents();
    }
    
    // Привязка событий UI
    bindUIEvents() {
        const connectBtn = document.getElementById('mp-connect-btn');
        const createGameBtn = document.getElementById('mp-create-game-btn');
        const readyBtn = document.getElementById('mp-ready-btn');
        const closeBtn = document.getElementById('mp-close-btn');
        const menuBtn = document.getElementById('mp-menu-btn');
        
        if (connectBtn) {
            connectBtn.addEventListener('click', () => this.connectToServer());
        }
        
        if (createGameBtn) {
            createGameBtn.addEventListener('click', () => this.createGame());
        }
        
        if (readyBtn) {
            readyBtn.addEventListener('click', () => this.toggleReady());
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeMenu());
        }
        
        if (menuBtn) {
            menuBtn.addEventListener('click', () => this.openMenu());
        }
    }
    
    // Настройка обработчиков событий
    setupEventHandlers() {
        this.client.on('connected', () => {
            this.updateConnectionStatus(true);
            this.showGamesList();
        });
        
        this.client.on('disconnected', () => {
            this.updateConnectionStatus(false);
        });
        
        this.client.on('gamesList', (games) => {
            this.displayGamesList(games);
        });
        
        this.client.on('gameCreated', (data) => {
            this.currentGameId = data.gameId;
            this.showLobby();
        });
        
        this.client.on('lobbyUpdate', (data) => {
            this.updateLobby(data);
        });
        
        this.client.on('gameStart', (data) => {
            this.startMultiplayerGame(data);
        });
        
        this.client.on('gameSync', (data) => {
            this.syncGameState(data);
        });
    }
    
    // Подключение к серверу
    connectToServer() {
        this.client.connect();
    }
    
    // Обновление статуса подключения
    updateConnectionStatus(connected) {
        const statusText = document.getElementById('mp-connection-text');
        const connectBtn = document.getElementById('mp-connect-btn');
        
        if (connected) {
            statusText.textContent = 'Подключено';
            statusText.style.color = '#3fb950';
            connectBtn.textContent = 'Отключиться';
            connectBtn.onclick = () => this.disconnect();
        } else {
            statusText.textContent = 'Отключено';
            statusText.style.color = '#f85149';
            connectBtn.textContent = 'Подключиться';
            connectBtn.onclick = () => this.connectToServer();
        }
    }
    
    // Показ списка игр
    showGamesList() {
        document.getElementById('mp-connection-status').style.display = 'none';
        document.getElementById('mp-game-list').style.display = 'block';
        document.getElementById('mp-lobby').style.display = 'none';
        
        this.client.getGamesList();
    }
    
    // Отображение списка игр
    displayGamesList(games) {
        const container = document.getElementById('mp-games-container');
        container.innerHTML = '';
        
        if (games.length === 0) {
            container.innerHTML = '<p>Нет доступных игр</p>';
            return;
        }
        
        games.forEach(game => {
            const gameDiv = document.createElement('div');
            gameDiv.className = 'mp-game-item';
            gameDiv.innerHTML = `
                <div class="mp-game-info">
                    <span class="mp-game-id">${game.id}</span>
                    <span class="mp-game-players">${game.players}/${game.maxPlayers} игроков</span>
                </div>
                <button class="hoi-btn btn-gold" onclick="multiplayer.joinGame('${game.id}')">Присоединиться</button>
            `;
            container.appendChild(gameDiv);
        });
    }
    
    // Создание игры
    createGame() {
        this.client.createGame();
    }
    
    // Присоединение к игре
    joinGame(gameId) {
        this.currentGameId = gameId;
        this.showLobby();
    }
    
    // Показ лобби
    showLobby() {
        document.getElementById('mp-connection-status').style.display = 'none';
        document.getElementById('mp-game-list').style.display = 'none';
        document.getElementById('mp-lobby').style.display = 'block';
        
        this.displayCountrySelection();
    }
    
   // Отображение выбора стран
    displayCountrySelection() {
        const container = document.getElementById('mp-countries-grid');
        // Используем те же страны, что и в основной игре
        const countries = window.CONFIG ? window.CONFIG.countries : [
            { id: 1, name: 'Красная Империя', color: '#b71c1c' },
            { id: 2, name: 'Свободные Штаты', color: '#006064' },
            { id: 3, name: 'Стальной Пакт', color: '#4a148c' },
            { id: 4, name: 'Северная Уния', color: '#e65100' },
            { id: 5, name: 'Империя Солнца', color: '#1b5e20' },
            { id: 6, name: 'Золотая Орда', color: '#f57f17' },
            { id: 7, name: 'Морская Держава', color: '#0d47a1' },
            { id: 8, name: 'Пустынный Халифат', color: '#a67c00' },
            { id: 9, name: 'Ледяной Предел', color: '#546e7a' },
            { id: 10, name: 'Тигровый Союз', color: '#880e4f' },
            { id: 11, name: 'Речная Конфедерация', color: '#33691e' },
            { id: 12, name: 'Железный Трон', color: '#37474f' }
        ];
        
        container.innerHTML = '';
        countries.forEach(country => {
            const countryDiv = document.createElement('div');
            countryDiv.className = 'mp-country-item';
            countryDiv.innerHTML = `
                <div class="mp-country-flag" style="background-color: ${country.color}"></div>
                <div class="mp-country-name">${country.name}</div>
            `;
            countryDiv.onclick = () => this.selectCountry(country.id);
            container.appendChild(countryDiv);
        });
    }
    
    // Выбор страны
    selectCountry(countryId) {
        // Подсветка выбранной страны
        document.querySelectorAll('.mp-country-item').forEach(item => {
            item.classList.remove('selected');
        });
        event.currentTarget.classList.add('selected');
        
        // Присоединение к игре с выбранной страной
        const playerName = prompt('Введите ваше имя:') || 'Игрок';
        this.client.joinGame(this.currentGameId, playerName, countryId);
        
        document.getElementById('mp-ready-section').style.display = 'block';
    }
    
    // Обновление лобби
    updateLobby(data) {
        const playersList = document.getElementById('mp-players-list');
        playersList.innerHTML = '';
        
        data.players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'mp-player-item';
            playerDiv.innerHTML = `
                <div class="mp-player-name">${player.name}</div>
                <div class="mp-player-country" style="color: ${player.country.color}">${player.country.name}</div>
                <div class="mp-player-status">${player.ready ? 'Готов' : 'Не готов'}</div>
            `;
            playersList.appendChild(playerDiv);
        });
    }
    
    // Переключение готовности
    toggleReady() {
        const readyBtn = document.getElementById('mp-ready-btn');
        const isReady = readyBtn.textContent === 'Я готов';
        
        this.client.setPlayerReady(!isReady);
        readyBtn.textContent = isReady ? 'Не готов' : 'Я готов';
        readyBtn.className = isReady ? 'hoi-btn btn-gold' : 'hoi-btn btn-green';
    }
    
    // Начало мультиплеер игры
    startMultiplayerGame(data) {
        this.isMultiplayer = true;
        this.closeMenu();
        
        // Инициализация игры с данными от сервера
        if (window.initializeMultiplayerGame) {
            window.initializeMultiplayerGame(data);
        }
    }
    
    // Синхронизация состояния игры
    syncGameState(data) {
        if (window.updateMultiplayerGameState) {
            window.updateMultiplayerGameState(data);
        }
    }
    
    // Отключение
    disconnect() {
        this.client.disconnect();
        this.closeMenu();
    }
    
    // Открытие меню
    openMenu() {
        document.getElementById('multiplayer-menu').style.display = 'block';
    }
    
    // Закрытие меню
    closeMenu() {
        document.getElementById('multiplayer-menu').style.display = 'none';
    }
    
    // Отправка действия на сервер
    sendAction(type, data) {
        if (this.isMultiplayer) {
            this.client.sendGameAction(type, data);
        }
    }
}

// Глобальный экземпляр
let multiplayer;

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
    multiplayer = new MultiplayerIntegration();
    
    // Показ кнопку мультиплеера в топбаре
    const topbar = document.getElementById('topbar');
    if (topbar) {
        const mpBtn = document.getElementById('mp-menu-btn');
        if (mpBtn) {
            mpBtn.style.display = 'block';
            topbar.appendChild(mpBtn);
        }
    }
});

// Экспорт для использования в основной игре
window.multiplayer = multiplayer;
