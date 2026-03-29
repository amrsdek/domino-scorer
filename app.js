/**
 * Domino 101 PWA - App Logic
 */

const MAX_SCORE = 101;
const ARABIC_NUMERALS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

// Convert standard numbers to Arabic numbers
function toArabicNum(num) {
    if (num === null || num === undefined) return '';
    return num.toString().replace(/[0-9]/g, w => ARABIC_NUMERALS[w]);
}

const app = {
    // State
    state: {
        players: [], // Array of string names
        selectedSetupPlayers: [],
        game: {
            active: false,
            players: [], // { name: '', score: 0, history: [10, 5, ...], eliminated: false }
            historyStack: [], // Array of { playerId: index, scoreAdded: number, wasEliminated: boolean }
            currentInput: '' // String representation of current number typed
        },
        leaderboard: {}, // { "name": { wins: 0, losses: 0 } }
        settings: {
            wakeLock: false
        }
    },

    wakeLock: null,

    // Initialization
    init() {
        this.loadData();
        this.renderBankList();
        this.renderSetupList();
        this.renderLeaderboard();

        document.getElementById('wake-lock-toggle').checked = this.state.settings.wakeLock;
        if (this.state.settings.wakeLock) {
            this.requestWakeLock();
        }

        // Handle page visibility for wake lock
        document.addEventListener('visibilitychange', () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible' && this.state.settings.wakeLock) {
                this.requestWakeLock();
            }
        });

        // Register Service Worker for PWA
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(reg => console.log('Service Worker Registered'))
                .catch(err => console.error('Service Worker Error', err));
        }

        // Resume game if active
        if (this.state.game.active) {
            this.renderGame();
            this.navigate('game', true);
        } else {
            this.navigate('home', true);
        }
    },

    // --- Persistance ---
    loadData() {
        try {
            const data = localStorage.getItem('domino101_data');
            if (data) {
                const parsed = JSON.parse(data);
                this.state = { ...this.state, ...parsed };
                // Ensure legacy objects exist
                if (!this.state.leaderboard) this.state.leaderboard = {};
            }
        } catch (e) {
            console.error("Failed to load local storage", e);
        }
    },

    saveData() {
        localStorage.setItem('domino101_data', JSON.stringify(this.state));
    },

    // --- Navigation ---
    navigate(viewId, isInit = false) {
        document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

        const target = document.getElementById('view-' + viewId);
        if (target) {
            target.classList.remove('hidden');
            // Small setTimeout for transition
            setTimeout(() => target.classList.add('active'), 10);
        }

        if (viewId === 'setup') {
            this.state.selectedSetupPlayers = [];
            this.renderSetupList();
            this.updateStartButton();
        }
    },

    // --- Player Bank ---
    addPlayer() {
        const input = document.getElementById('new-player-name');
        const name = input.value.trim();

        if (!name) return;
        if (this.state.players.includes(name)) {
            this.showModal('خطأ', 'اللاعب موجود بالفعل!');
            return;
        }

        this.state.players.push(name);
        if (!this.state.leaderboard[name]) {
            this.state.leaderboard[name] = { wins: 0, losses: 0 };
        }

        this.saveData();
        this.renderBankList();
        input.value = '';
    },

    deletePlayer(name) {
        this.state.players = this.state.players.filter(p => p !== name);
        this.saveData();
        this.renderBankList();
        this.renderSetupList();
    },

    renderBankList() {
        const list = document.getElementById('player-list');
        list.innerHTML = '';
        if (this.state.players.length === 0) {
            list.innerHTML = '<div style="text-align:center; color: var(--text-gold-dim); padding: 20px;">لا يوجد لاعبين، أضف لاعباً جديداً.</div>';
            return;
        }

        this.state.players.forEach(name => {
            const li = document.createElement('li');
            li.className = 'list-item';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete';
            delBtn.innerHTML = '✖';
            delBtn.onclick = () => this.deletePlayer(name);

            li.appendChild(nameSpan);
            li.appendChild(delBtn);
            list.appendChild(li);
        });
    },

    // --- Setup Game ---
    renderSetupList() {
        const list = document.getElementById('setup-player-list');
        list.innerHTML = '';

        if (this.state.players.length === 0) {
            list.innerHTML = '<div style="text-align:center; color: var(--text-gold-dim); padding: 20px;">الرجاء إضافة لاعبين في الشلة أولاً.</div>';
            return;
        }

        this.state.players.forEach(name => {
            const div = document.createElement('div');
            div.className = 'selectable-item';
            div.textContent = name;

            if (this.state.selectedSetupPlayers.includes(name)) {
                div.classList.add('selected');
            }

            div.onclick = () => this.togglePlayerSelect(name, div);
            list.appendChild(div);
        });
    },

    togglePlayerSelect(name, el) {
        const idx = this.state.selectedSetupPlayers.indexOf(name);
        if (idx > -1) {
            this.state.selectedSetupPlayers.splice(idx, 1);
            el.classList.remove('selected');
        } else {
            if (this.state.selectedSetupPlayers.length >= 4) {
                this.showModal('تنبيه', 'أقصى عدد للاعبين هو ٤ فقط!');
                return;
            }
            this.state.selectedSetupPlayers.push(name);
            el.classList.add('selected');
        }
        this.updateStartButton();
    },

    updateStartButton() {
        const btn = document.getElementById('btn-start-game');
        const count = this.state.selectedSetupPlayers.length;
        btn.disabled = count < 2;
    },

    startGame() {
        if (this.state.selectedSetupPlayers.length < 2) return;

        this.state.game = {
            active: true,
            players: this.state.selectedSetupPlayers.map(name => ({
                name: name,
                score: 0,
                history: [],
                eliminated: false
            })),
            historyStack: [],
            currentInput: ''
        };

        this.saveData();
        this.requestWakeLock();
        this.renderGame();
        this.navigate('game');
    },

    // --- Game Logic ---
    renderGame() {
        const board = document.getElementById('scoreboard');
        const actions = document.getElementById('game-player-actions');

        board.innerHTML = '';
        actions.innerHTML = '';

        // Input Display
        const inputDisplay = document.createElement('div');
        inputDisplay.className = 'current-input-display' + (this.state.game.currentInput ? '' : ' empty');
        inputDisplay.textContent = this.state.game.currentInput ? toArabicNum(this.state.game.currentInput) : 'اختر رقماً للإضافة...';
        actions.appendChild(inputDisplay);

        this.state.game.players.forEach((p, idx) => {
            // Render Column
            const col = document.createElement('div');
            col.className = 'player-col' + (p.eliminated ? ' eliminated' : '');

            const nameDiv = document.createElement('div');
            nameDiv.className = 'player-name';
            nameDiv.textContent = p.name;

            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'player-score';
            scoreDiv.textContent = toArabicNum(p.score);

            const historyDiv = document.createElement('div');
            historyDiv.className = 'player-history';

            // Render history from oldest to newest (top to bottom or vice versa)
            p.history.slice().reverse().forEach((s, i) => {
                const hItem = document.createElement('div');
                hItem.className = 'history-item' + (i === 0 ? ' new' : '');
                hItem.textContent = '+ ' + toArabicNum(s);
                historyDiv.appendChild(hItem);
            });

            col.appendChild(nameDiv);
            col.appendChild(scoreDiv);
            col.appendChild(historyDiv);
            board.appendChild(col);

            // Render Action Button
            if (!p.eliminated && this.state.game.currentInput) {
                const btn = document.createElement('button');
                btn.className = 'btn-apply-score';
                btn.textContent = 'أضف لـ ' + p.name;
                btn.onclick = () => this.applyScore(idx);
                actions.appendChild(btn);
            }
        });
    },

    inputNumber(num) {
        if (this.state.game.currentInput.length >= 3) return; // Prevent >999
        if (this.state.game.currentInput === '0' && num === 0) return;
        this.state.game.currentInput += num.toString();
        // remove leading zero if not alone
        if (this.state.game.currentInput.length > 1 && this.state.game.currentInput.startsWith('0')) {
            this.state.game.currentInput = this.state.game.currentInput.substring(1);
        }
        this.saveData();
        this.renderGame();
    },

    clearInput() {
        this.state.game.currentInput = '';
        this.saveData();
        this.renderGame();
    },

    applyScore(playerIndex) {
        if (!this.state.game.currentInput) return;

        const scoreToAdd = parseInt(this.state.game.currentInput, 10);
        const p = this.state.game.players[playerIndex];

        p.score += scoreToAdd;
        p.history.push(scoreToAdd);

        let hasWon = false;
        if (p.score >= MAX_SCORE) {
            hasWon = true;
        }

        this.state.game.historyStack.push({
            playerId: playerIndex,
            scoreAdded: scoreToAdd,
            hasWon: hasWon
        });

        this.state.game.currentInput = '';
        this.saveData();
        this.renderGame();

        if (hasWon) {
            setTimeout(() => {
                this.finalizeGame(p);
            }, 500);
        }
    },

    undoLastAction() {
        if (this.state.game.historyStack.length === 0) return;

        const lastAction = this.state.game.historyStack.pop();
        const p = this.state.game.players[lastAction.playerId];

        p.score -= lastAction.scoreAdded;
        p.history.pop();

        this.saveData();
        this.renderGame();
    },

    endGameConfirm() {
        this.showModal('إنهاء اللعبة', 'هل أنت متأكد من إنهاء هذه الطاولة دون تسجيل فائز؟', () => {
            this.state.game.active = false;
            this.saveData();
            this.navigate('home');
            if (this.wakeLock) this.releaseWakeLock();
        }, true);
    },

    finalizeGame(winner) {
        let msg = winner ? 'مبروك يا معلم ' + winner.name + '، اكتسحت الجيم! 🏆' : 'انتهت اللعبة!';

        const processStats = () => {
            if (winner && this.state.leaderboard[winner.name]) {
                this.state.leaderboard[winner.name].wins++;
            }
            this.state.game.players.forEach(p => {
                if (winner && p.name !== winner.name) {
                    if (this.state.leaderboard[p.name]) {
                        this.state.leaderboard[p.name].losses++;
                    }
                }
            });
        };

        this.showCustomModal('نهاية الجيم 🏆', msg, [
            {
                text: 'إلغاء و تراجع ↩️', class: 'btn-danger', onclick: () => {
                    this.closeModal();
                    this.undoLastAction();
                }
            },
            {
                text: 'ابدأ عشرة جديدة 🔄', class: 'btn-primary btn-large', onclick: () => {
                    this.closeModal();
                    processStats();
                    this.state.game.players.forEach(p => {
                        p.score = 0;
                        p.history = [];
                        p.eliminated = false;
                    });
                    this.state.game.historyStack = [];
                    this.state.game.currentInput = '';
                    this.saveData();
                    this.renderGame();
                }
            },
            {
                text: 'إنهاء للخلفية 🛑', class: 'btn-secondary', onclick: () => {
                    this.closeModal();
                    processStats();
                    this.state.game.active = false;
                    this.saveData();
                    this.renderLeaderboard();
                    this.navigate('leaderboard');
                    if (this.wakeLock) this.releaseWakeLock();
                }
            }
        ]);
    },

    // --- Leaderboard ---
    renderLeaderboard() {
        const tbody = document.getElementById('leaderboard-body');
        tbody.innerHTML = '';

        // Convert to array and sort by wins
        const sorted = Object.entries(this.state.leaderboard)
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.wins - a.wins || a.losses - b.losses); // Tie breaker: fewer losses

        if (sorted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-gold-dim)">لا توجد بيانات بعد</td></tr>';
            return;
        }

        sorted.forEach(s => {
            const tr = document.createElement('tr');

            const td1 = document.createElement('td');
            td1.textContent = s.name;

            const td2 = document.createElement('td');
            td2.textContent = toArabicNum(s.wins);

            const td3 = document.createElement('td');
            td3.textContent = toArabicNum(s.losses);

            tr.appendChild(td1);
            tr.appendChild(td2);
            tr.appendChild(td3);
            tbody.appendChild(tr);
        });
    },

    // --- Settings / Utilities ---
    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator && this.state.settings.wakeLock) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock is active');
            }
        } catch (err) {
            console.error('WakeLock Error:', err.name, err.message);
        }
    },

    releaseWakeLock() {
        if (this.wakeLock !== null) {
            this.wakeLock.release().then(() => {
                this.wakeLock = null;
                console.log('Wake Lock released');
            });
        }
    },

    toggleWakeLockSetting(isChecked) {
        this.state.settings.wakeLock = isChecked;
        this.saveData();
        if (isChecked && this.state.game.active) {
            this.requestWakeLock();
        } else {
            this.releaseWakeLock();
        }
    },

    exportData() {
        const dataStr = JSON.stringify(this.state);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportFileDefaultName = 'domino101_backup.json';

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    },

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.players && typeof parsed.game === 'object') {
                    this.state = parsed;
                    this.saveData();
                    this.init(); // Reinitialize
                    this.showModal('نجاح', 'تم استيراد البيانات بنجاح!');
                } else {
                    this.showModal('خطأ', 'ملف غير صالح!');
                }
            } catch (err) {
                this.showModal('خطأ', 'حدث خطأ أثناء الاستيراد');
            }
        };
        reader.readAsText(file);
    },

    factoryResetConfirm() {
        this.showModal('تحذير خطير ⚠️', 'هل أنت متأكد من مسح جميع الأسماء والنتائج والتاريخ؟', () => {
            localStorage.removeItem('domino101_data');
            // reset state
            this.state = {
                players: [],
                selectedSetupPlayers: [],
                game: { active: false, players: [], historyStack: [], currentInput: '' },
                leaderboard: {},
                settings: { wakeLock: false }
            };
            this.init();
            this.showModal('تم', 'تم مسح جميع البيانات بنجاح.');
        }, true);
    },

    // --- Modal ---
    showModal(title, message, callback = null, showCancel = false, isUndo = false) {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = message;

        const actions = document.getElementById('modal-actions');
        actions.innerHTML = '';

        if (showCancel) {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.innerText = isUndo ? 'إلغاء و تراجع ↩️' : 'إلغاء';
            cancelBtn.onclick = () => {
                this.closeModal();
                if (isUndo) {
                    this.undoLastAction();
                }
            };
            actions.appendChild(cancelBtn);
        }

        const primaryBtn = document.createElement('button');
        primaryBtn.className = 'btn btn-primary';
        primaryBtn.innerText = 'حسناً';
        primaryBtn.onclick = () => {
            this.closeModal();
            if (callback) callback();
        };
        actions.appendChild(primaryBtn);

        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('hidden');
    },

    showCustomModal(title, message, buttons) {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = message;

        const actions = document.getElementById('modal-actions');
        actions.innerHTML = '';
        actions.style.flexDirection = 'column';

        buttons.forEach(btn => {
            const domBtn = document.createElement('button');
            domBtn.className = 'btn ' + (btn.class || 'btn-primary');
            domBtn.innerText = btn.text;
            domBtn.onclick = btn.onclick;
            actions.appendChild(domBtn);
        });

        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('hidden');
    },

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }
};

// Start app
window.onload = () => {
    app.init();
};
