        // ==========================================
        // 🔑 CONFIGURAÇÕES DO BANCO TURSO AQUI:
        // ==========================================
        const TURSO_URL = "https://ivr-tv-sou-guz.aws-us-east-1.turso.io"; 
        const TURSO_AUTH_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODQwNTc0NzEsImlkIjoiMDE5ZjYyMTYtZmYwMS03NzNmLTg4ZTYtYTAzZjNmNmE4ODgzIiwia2lkIjoiVHE2QTB1MlV5WXFveExYUjBndy1PNjNIYUJ0d0N5STd1cGpUbWVDb1BhOCIsInJpZCI6IjU5YTFmMmVjLTFmMTItNDgzMi1hNWUzLWM0ZmUxOWZhNDkyZCJ9.boSgwpRGCUtW1T5YIIvLEQ5AB7ZET2i86W8BIR4Am_WDxIU97JB24c0z6fIA-oPHJAjCOoKAHJpqsFj5l4EdCg";

        function encodeSqlValue(v) {
            if (v === null || v === undefined) return { type: 'null' };
            if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
            if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
            return { type: 'text', value: String(v) };
        }
        function decodeSqlValue(v) {
            if (!v || v.type === 'null') return null;
            if (v.type === 'integer') return Number(v.value);
            if (v.type === 'float') return v.value;
            if (v.type === 'text') return v.value;
            if (v.type === 'blob') return v.base64;
            return null;
        }

        function createHttpTursoClient(url, authToken) {
            const pipelineUrl = url.replace(/\/$/, '') + '/v2/pipeline';
            return {
                async execute(sqlOrObj) {
                    const isObj = typeof sqlOrObj === 'object' && sqlOrObj !== null;
                    const sql = isObj ? sqlOrObj.sql : sqlOrObj;
                    const args = (isObj && Array.isArray(sqlOrObj.args)) ? sqlOrObj.args.map(encodeSqlValue) : [];

                    const res = await fetch(pipelineUrl, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requests: [ { type: 'execute', stmt: { sql, args, want_rows: true } }, { type: 'close' } ] })
                    });

                    if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${await res.text().catch(() => '')}`);
                    const data = await res.json();
                    const execResult = data.results && data.results[0];
                    if (!execResult) throw new Error('Resposta inesperada do Turso.');
                    if (execResult.type === 'error') throw new Error(execResult.error?.message || 'Erro SQL no Turso.');

                    const stmtResult = execResult.response.result;
                    const colNames = (stmtResult.cols || []).map(c => c.name);
                    const rows = (stmtResult.rows || []).map(row => {
                        const obj = {};
                        colNames.forEach((name, i) => { obj[name] = decodeSqlValue(row[i]); });
                        return obj;
                    });
                    return {
                        rows,
                        rowsAffected: Number(stmtResult.affected_row_count || 0),
                        lastInsertRowid: stmtResult.last_insert_rowid
                    };
                }
            };
        }

        let dbClient = null;
        if (TURSO_URL && TURSO_AUTH_TOKEN) {
            dbClient = createHttpTursoClient(TURSO_URL, TURSO_AUTH_TOKEN);
        }

        const DEADLINES_CONFIG = {
            'livre': { text: 'Sem Restrição', colorClass: 'status-green', order: 1 },
            'manha': { text: 'Somente Manhã', colorClass: 'status-yellow', order: 2 },
            'tarde': { text: 'Somente à Tarde', colorClass: 'status-yellow', order: 3 },
            '24h': { text: '24 Horas', colorClass: 'status-orange', order: 4 },
            '48h': { text: '48 Horas', colorClass: 'status-red', order: 5 }
        };

        const LEGACY_TEMP_PLACEHOLDER = 0;
        const LEGACY_EMOJI_PLACEHOLDER = '🌡️';

        const DEFAULT_CITIES = [
            { name: "Campo Grande", uf: "MS", deadline: "livre" },
            { name: "Dourados", uf: "MS", deadline: "48h" },
            { name: "Sidrolândia", uf: "MS", deadline: "tarde" },
            { name: "Três Lagoas", uf: "MS", deadline: "24h" },
            { name: "Corumbá", uf: "MS", deadline: "livre" },
            { name: "Ponta Porã", uf: "MS", deadline: "48h" }
        ];

        const BR_UF_TO_STATE = {
            AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
            DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
            MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
            PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
            RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
            SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins'
        };

        function getWeatherEmoji(code, isDay) {
            const dayEmojis = {
                0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
                51: '🌦️', 53: '🌦️', 55: '🌦️', 56: '🌧️', 57: '🌧️',
                61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
                71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️',
                80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '🌨️',
                95: '⛈️', 96: '⛈️', 99: '⛈️'
            };
            const nightEmojis = {
                0: '🌙', 1: '🌒', 2: '☁️', 3: '☁️'
            };
            
            if (isDay === 0 && nightEmojis[code]) {
                return nightEmojis[code];
            }
            return dayEmojis[code] || '🌡️';
        }

        function weatherKeyFor(name, uf) { return `${name}|${uf}`.toLowerCase(); }

        async function geocodeCity(name, uf) {
            const cacheKey = `ivr_geo_${name.toLowerCase()}_${(uf || '').toLowerCase()}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) { try { return JSON.parse(cached); } catch (e) { } }

            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=pt&format=json`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Falha ao geocodificar cidade');
            const data = await res.json();
            const results = data.results || [];
            const stateName = BR_UF_TO_STATE[(uf || '').toUpperCase()];

            const match = results.find(r => r.country_code === 'BR' && stateName && r.admin1 === stateName)
                || results.find(r => r.country_code === 'BR')
                || results[0];

            if (!match) throw new Error('Cidade não encontrada na base de geocodificação');
            const coords = { lat: match.latitude, lon: match.longitude };
            localStorage.setItem(cacheKey, JSON.stringify(coords));
            return coords;
        }

        const weatherCache = {};
        const WEATHER_REFRESH_MS = 20 * 60 * 1000; 

        async function loadCityWeather(city) {
            const key = weatherKeyFor(city.name, city.uf);
            if (city._lat == null || city._lon == null) return;

            const entry = weatherCache[key] || (weatherCache[key] = {});
            if (entry.loading) return; 
            entry.loading = true;

            try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${city._lat}&longitude=${city._lon}&current=temperature_2m,weather_code,is_day&timezone=auto`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Falha ao buscar previsão (HTTP ${res.status})`);
                const data = await res.json();
                const temp = Math.round(data.current.temperature_2m);
                const code = data.current.weather_code;
                const isDay = data.current.is_day;
                
                const emoji = getWeatherEmoji(code, isDay);
                
                Object.assign(entry, { temp, emoji, error: false, updatedAt: Date.now() });
            } catch (e) {
                console.warn(`Não foi possível obter o clima de ${city.name}/${city.uf}:`, e);
                Object.assign(entry, { temp: '--', emoji: '⚠️', error: true, updatedAt: Date.now() });
            } finally {
                entry.loading = false;
                applyWeatherToDom(key, entry);
            }
        }

        function applyWeatherToDom(key, entry) {
            document.querySelectorAll(`.city-weather[data-weather-key="${cssEscapeKey(key)}"]`).forEach(el => {
                const emojiEl = el.querySelector('.city-weather-emoji');
                const tempEl = el.querySelector('.city-weather-temp');
                if (emojiEl) emojiEl.textContent = entry.emoji || '⏳';
                if (tempEl) tempEl.textContent = (entry.temp === undefined) ? '...' : `${entry.temp}°C`;
            });
        }

        function cssEscapeKey(key) {
            return (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
        }

        function refreshWeatherForCities(cities) {
            const now = Date.now();
            cities.forEach(city => {
                if (city._lat == null || city._lon == null) return;
                const key = weatherKeyFor(city.name, city.uf);
                const entry = weatherCache[key];
                const stale = !entry || entry.updatedAt === undefined || (now - entry.updatedAt) > WEATHER_REFRESH_MS;
                if (stale) loadCityWeather(city);
            });
        }

        // ==========================================
        // ÁUDIO E NOTIFICAÇÕES NATIVAS (Web Audio API)
        // ==========================================
        let audioCtx = null;
        let initialDataLoaded = false;
        let knownAlertIds = new Set();

        function getAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }

        function playChatSound() {
            try {
                const ctx = getAudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, ctx.currentTime);
                gain.gain.setValueAtTime(0.05, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.1);
            } catch(e){}
        }

        function playAlertSound() {
            try {
                const ctx = getAudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(500, ctx.currentTime);
                osc.frequency.setValueAtTime(750, ctx.currentTime + 0.15); 
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.5);
            } catch(e){}
        }

        let citiesState = [];
        let alertsState = [];
        let isEditorMode = false;
        let currentUser = null;
        let clockInterval = null;
        let chatPollInterval = null;
        let lastChatId = 0;
        let unreadChatCount = 0;
        let avatarsCache = {}; 
        let defaultAvatarSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2362727d'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

        const dom = {
            loginView: document.getElementById('login-view'),
            appView: document.getElementById('app-view'),
            loginUser: document.getElementById('login-user'),
            loginPass: document.getElementById('login-pass'),
            loginMsg: document.getElementById('login-msg'),
            btnLogin: document.getElementById('btn-login'),
            btnRegister: document.getElementById('btn-register'),
            rememberMe: document.getElementById('remember-me'),
            citiesContainer: document.getElementById('cities-container'),
            searchInput: document.getElementById('search-input'),
            btnToggleEditor: document.getElementById('btn-toggle-editor'),
            btnLogout: document.getElementById('btn-logout'),
            btnProfile: document.getElementById('btn-profile'),
            topbarAvatar: document.getElementById('topbar-avatar'),
            adminPanel: document.getElementById('admin-panel'),
            btnThemeToggle: document.getElementById('btn-theme-toggle'),
            liveTime: document.getElementById('live-time'),
            liveDate: document.getElementById('live-date'),
            cityForm: document.getElementById('city-form'),
            inputCityName: document.getElementById('input-city-name'),
            inputCityUf: document.getElementById('input-city-uf'),
            selectDeadline: document.getElementById('select-deadline'),
            btnSubmitForm: document.getElementById('btn-submit-form'),
            btnCancelEdit: document.getElementById('btn-cancel-edit'),
            editIndex: document.getElementById('edit-index'),
            panelTitle: document.getElementById('panel-title'),
            alertForm: document.getElementById('alert-form'),
            inputAlertTitle: document.getElementById('input-alert-title'),
            inputAlertText: document.getElementById('input-alert-text'),
            selectAlertColor: document.getElementById('select-alert-color'),
            selectAlertDuration: document.getElementById('select-alert-duration'),
            btnSubmitAlert: document.getElementById('btn-submit-alert'),
            btnCancelAlertEdit: document.getElementById('btn-cancel-alert-edit'),
            alertEditIndex: document.getElementById('alert-edit-index'),
            alertsPanel: document.getElementById('alerts-panel'),
            alertsList: document.getElementById('alerts-list'),
            btnQuickAlert: document.getElementById('btn-quick-alert'),
            quickAlertModal: document.getElementById('quick-alert-modal'),
            btnCloseModal: document.getElementById('btn-close-modal'),
            quickAlertForm: document.getElementById('quick-alert-form'),
            qaTitle: document.getElementById('qa-title'),
            qaText: document.getElementById('qa-text'),
            qaDuration: document.getElementById('qa-duration'),
            qaColor: document.getElementById('qa-color'),
            pendingUsersList: document.getElementById('pending-users-list'),
            activeUsersList: document.getElementById('active-users-list'),
            lastUpdate: document.getElementById('last-update'),
            toastContainer: document.getElementById('toast-container'),
            chatSidebar: document.getElementById('chat-sidebar'),
            chatMessages: document.getElementById('chat-messages'),
            chatForm: document.getElementById('chat-form'),
            chatInput: document.getElementById('chat-input'),
            btnCloseChat: document.getElementById('btn-close-chat'),
            btnToggleChat: document.getElementById('btn-toggle-chat'),
            chatFabBadge: document.getElementById('chat-fab-badge'),
            
            // Perfil
            profileModal: document.getElementById('profile-modal'),
            btnCloseProfile: document.getElementById('btn-close-profile'),
            profileForm: document.getElementById('profile-form'),
            profileUsername: document.getElementById('profile-username'),
            profilePassword: document.getElementById('profile-password'),
            profilePicInput: document.getElementById('profile-pic-input'),
            profilePreview: document.getElementById('profile-preview'),
        };

        window.editAlert = editAlert;
        window.deleteAlert = deleteAlert;
        window.approveUser = approveUser;
        window.deleteUser = deleteUser;
        window.deleteChatMessage = deleteChatMessage;

        document.addEventListener('DOMContentLoaded', async () => {
            const savedTheme = localStorage.getItem('ivr_tv_theme') || 'dark';
            setTheme(savedTheme);

            if (!dbClient) {
                dom.loginMsg.innerText = "Erro: Banco Turso não configurado no código.";
                return;
            }

            try {
                await dbClient.execute(`CREATE TABLE IF NOT EXISTS support_users (username TEXT PRIMARY KEY, password TEXT NOT NULL, role TEXT NOT NULL, is_approved INTEGER NOT NULL)`);
                await dbClient.execute(`CREATE TABLE IF NOT EXISTS cities (name TEXT PRIMARY KEY, uf TEXT NOT NULL, deadline TEXT NOT NULL, temp INTEGER NOT NULL, emoji TEXT NOT NULL)`);
                await dbClient.execute(`CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL)`);
                await dbClient.execute(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
                await dbClient.execute(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)`);
                
                try { await dbClient.execute("ALTER TABLE alerts ADD COLUMN created_at TEXT"); } catch(e) {}
                try { await dbClient.execute("ALTER TABLE alerts ADD COLUMN duration_hours INTEGER"); } catch(e) {}
                try { await dbClient.execute("ALTER TABLE alerts ADD COLUMN username TEXT"); } catch(e) {}
                try { await dbClient.execute("ALTER TABLE support_users ADD COLUMN profile_pic TEXT"); } catch(e) {}

            } catch (e) {
                console.error("Erro ao configurar tabelas:", e);
                dom.loginMsg.innerText = "Erro ao conectar com o banco de dados.";
            }

            checkSession();
            registerAuthEvents();
        });

        function checkSession() {
            let sessionStr = sessionStorage.getItem('ivr_session') || localStorage.getItem('ivr_session');
            if (sessionStr) {
                currentUser = JSON.parse(sessionStr);
                sessionStorage.setItem('ivr_session', sessionStr); 
                showApp();
                verifySessionRealTime();
            } else {
                dom.loginView.style.display = 'flex';
                dom.appView.style.display = 'none';
            }
        }

        async function verifySessionRealTime() {
            if (!currentUser || !dbClient) return;
            try {
                const res = await dbClient.execute({
                    sql: "SELECT is_approved FROM support_users WHERE username = ? AND password = ?",
                    args: [currentUser.username, currentUser.password]
                });
                
                if (res.rows.length === 0 || res.rows[0].is_approved === 0) {
                    forceLogout("Sua sessão expirou ou seu acesso foi revogado.");
                }
            } catch(e) { }
        }

        function forceLogout(msg) {
            sessionStorage.removeItem('ivr_session');
            localStorage.removeItem('ivr_session');
            currentUser = null;
            if(isEditorMode) toggleEditorMode();
            citiesState = [];
            alertsState = [];
            dom.appView.style.display = 'none';
            dom.loginView.style.display = 'flex';
            if(autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
            if(clockInterval) { clearInterval(clockInterval); clockInterval = null; }
            stopChatPolling();
            lastChatId = 0;
            unreadChatCount = 0;
            initialDataLoaded = false;
            knownAlertIds.clear();
            dom.chatMessages.innerHTML = '<p class="chat-empty">Nenhuma mensagem ainda. Seja o primeiro a dizer oi! 👋</p>';
            dom.chatSidebar.classList.remove('open');
            
            dom.loginUser.value = '';
            dom.loginPass.value = '';
            if (msg) {
                dom.loginMsg.style.color = '#ef4444';
                dom.loginMsg.innerText = msg;
            }
        }

        function registerAuthEvents() {
            const pressEnterToLogin = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    dom.btnLogin.click(); 
                }
            };
            dom.loginUser.addEventListener('keypress', pressEnterToLogin);
            dom.loginPass.addEventListener('keypress', pressEnterToLogin);

            dom.btnRegister.addEventListener('click', async (e) => {
                e.preventDefault();
                const user = dom.loginUser.value.trim();
                const pass = dom.loginPass.value.trim();
                if(!user || !pass) return dom.loginMsg.innerText = "Preencha e-mail e senha.";

                try {
                    const role = user === 'admin' ? 'admin' : 'user';
                    const isApproved = user === 'admin' ? 1 : 0;
                    await dbClient.execute({
                        sql: "INSERT INTO support_users (username, password, role, is_approved) VALUES (?, ?, ?, ?)",
                        args: [user, pass, role, isApproved]
                    });
                    dom.loginMsg.style.color = '#10b981';
                    dom.loginMsg.innerText = user === 'admin' ? "Admin criado! Agora clique em Entrar." : "Solicitação enviada. Aguarde aprovação do Admin.";
                } catch(e) {
                    dom.loginMsg.style.color = '#ef4444';
                    dom.loginMsg.innerText = "Usuário já existe. Tente fazer login.";
                }
            });

            dom.btnLogin.addEventListener('click', async () => {
                getAudioContext(); // Prepara o contexto de áudio logo no clique (interação do usuário)
                const user = dom.loginUser.value.trim();
                const pass = dom.loginPass.value.trim();
                if(!user || !pass) return dom.loginMsg.innerText = "Preencha e-mail e senha.";

                dom.loginMsg.style.color = '#ef4444';
                dom.loginMsg.innerText = "Conectando...";

                try {
                    const res = await dbClient.execute({
                        sql: "SELECT * FROM support_users WHERE username = ? AND password = ?",
                        args: [user, pass]
                    });

                    if(res.rows.length === 0) return dom.loginMsg.innerText = "Usuário ou senha incorretos.";
                    
                    const userData = res.rows[0];
                    if(userData.is_approved === 0) return dom.loginMsg.innerText = "Seu acesso ainda não foi aprovado pelo Admin.";

                    const sessionData = { username: userData.username, role: userData.role, password: pass };
                    sessionStorage.setItem('ivr_session', JSON.stringify(sessionData));
                    
                    if (dom.rememberMe && dom.rememberMe.checked) {
                        localStorage.setItem('ivr_session', JSON.stringify(sessionData));
                    } else {
                        localStorage.removeItem('ivr_session');
                    }
                    
                    currentUser = sessionData;
                    
                    dom.loginUser.value = '';
                    dom.loginPass.value = '';
                    dom.loginMsg.innerText = '';
                    
                    showApp();
                } catch(e) {
                    console.error(e);
                    dom.loginMsg.innerText = "Erro de conexão com o banco.";
                }
            });

            dom.btnLogout.addEventListener('click', () => {
                forceLogout("Você saiu com sucesso.");
            });
        }

        async function fetchAvatars() {
            if (!dbClient) return;
            try {
                const res = await dbClient.execute("SELECT username, profile_pic FROM support_users");
                avatarsCache = {}; 
                res.rows.forEach(r => {
                    if (r.profile_pic) avatarsCache[r.username] = r.profile_pic;
                });
            } catch (e) { console.error("Erro ao buscar avatares"); }
        }

        async function showApp() {
            dom.loginView.style.display = 'none';
            dom.appView.style.display = 'flex';
            
            if (currentUser.role !== 'admin') {
                dom.btnToggleEditor.style.display = 'none';
                dom.btnQuickAlert.style.display = 'flex'; 
            } else {
                dom.btnToggleEditor.style.display = 'inline-flex';
                dom.btnQuickAlert.style.display = 'none'; 
                fetchUsers();
            }

            dom.btnLogout.innerHTML = `🚪 Sair (${currentUser.username})`;
            
            registerAppEvents();
            startLiveClock();
            
            await fetchAvatars();
            dom.topbarAvatar.src = avatarsCache[currentUser.username] || defaultAvatarSvg;
            
            await fetchAllData();
            await fetchChatMessages();
            
            initialDataLoaded = true; // Permite que sons comecem a tocar a partir de agora
            
            startAutoRefresh();
            startChatPolling();
        }

        let autoRefreshInterval = null;
        function startAutoRefresh() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            autoRefreshInterval = setInterval(() => {
                if (!dbClient) return;
                verifySessionRealTime(); 
                if (!isEditorMode) fetchAllData();
            }, 5000); 
        }

        // ==========================================
        // LÓGICA DO PERFIL (AVATAR, SENHA, NOME)
        // ==========================================
        function openProfileModal() {
            dom.profileUsername.value = currentUser.username;
            dom.profilePassword.value = '';
            dom.profilePicInput.value = '';
            
            dom.profilePreview.src = avatarsCache[currentUser.username] || defaultAvatarSvg;
            dom.profileModal.classList.add('active');
        }

        function closeProfileModal() {
            dom.profileModal.classList.remove('active');
        }

        async function compressImage(file, maxSize = 150) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;

                        if (width > height) {
                            if (width > maxSize) { height *= maxSize / width; width = maxSize; }
                        } else {
                            if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', 0.8));
                    };
                };
            });
        }

        dom.profilePicInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            dom.profilePreview.src = "https://via.placeholder.com/80?text=⏳";
            const compressedBase64 = await compressImage(file);
            dom.profilePreview.src = compressedBase64;
        });

        dom.profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btnSubmit = dom.profileForm.querySelector('button[type="submit"]');
            const textOriginal = btnSubmit.textContent;
            btnSubmit.textContent = 'Salvando...';
            btnSubmit.disabled = true;

            const newUsername = dom.profileUsername.value.trim();
            const newPassword = dom.profilePassword.value.trim() || currentUser.password;
            
            const isDefault = dom.profilePreview.src.includes('data:image/svg+xml') || dom.profilePreview.src.includes('via.placeholder.com');
            const newPic = isDefault ? null : dom.profilePreview.src;

            try {
                let sql = "UPDATE support_users SET username = ?, password = ?";
                let args = [newUsername, newPassword];
                
                if (newPic) {
                    sql += ", profile_pic = ?";
                    args.push(newPic);
                }
                
                sql += " WHERE username = ?";
                args.push(currentUser.username);
                
                await dbClient.execute({ sql, args });

                if (newUsername !== currentUser.username) {
                    await dbClient.execute({ sql: "UPDATE chat_messages SET username = ? WHERE username = ?", args: [newUsername, currentUser.username] });
                    await dbClient.execute({ sql: "UPDATE alerts SET username = ? WHERE username = ?", args: [newUsername, currentUser.username] });
                }

                currentUser.username = newUsername;
                currentUser.password = newPassword;
                const sessionData = JSON.stringify(currentUser);
                sessionStorage.setItem('ivr_session', sessionData);
                if (localStorage.getItem('ivr_session')) {
                    localStorage.setItem('ivr_session', sessionData);
                }

                dom.btnLogout.innerHTML = `🚪 Sair (${currentUser.username})`;
                await fetchAvatars(); 
                dom.topbarAvatar.src = avatarsCache[currentUser.username] || defaultAvatarSvg;
                fetchChatMessages();
                
                showToast("Perfil atualizado com sucesso!");
                closeProfileModal();

            } catch (err) {
                console.error(err);
                showToast("Erro ao atualizar o perfil. O e-mail já existe?", "error");
            } finally {
                btnSubmit.textContent = textOriginal;
                btnSubmit.disabled = false;
            }
        });


        // ==========================================
        // 💬 CHAT DA EQUIPE
        // ==========================================
        function startChatPolling() {
            if (chatPollInterval) clearInterval(chatPollInterval);
            chatPollInterval = setInterval(fetchChatMessages, 3000);
        }

        function stopChatPolling() {
            if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
        }

        function getDeleteButtonHTML(msg) {
            if (!currentUser) return '';
            const isAdmin = currentUser.role === 'admin';
            const isOwn = msg.username === currentUser.username;
            const ageMins = (Date.now() - new Date(msg.created_at).getTime()) / (1000 * 60);

            if (isAdmin || (isOwn && ageMins <= 10)) {
                return `<button class="btn-delete-chat" onclick="deleteChatMessage(${msg.id})" title="Apagar Mensagem">🗑️</button>`;
            }
            return '';
        }

        async function fetchChatMessages() {
            if (!dbClient || !currentUser) return;
            try {
                const res = await dbClient.execute("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100");
                const messages = res.rows.reverse();

                const currentMsgElements = Array.from(dom.chatMessages.querySelectorAll('.chat-message'));
                const currentMsgIds = currentMsgElements.map(el => parseInt(el.dataset.id));
                const fetchedMsgIds = messages.map(m => m.id);

                let hasChanges = false;
                let hasNewMessage = false;

                currentMsgIds.forEach(id => {
                    if (!fetchedMsgIds.includes(id)) {
                        const el = document.querySelector(`.chat-message[data-id="${id}"]`);
                        if (el) el.remove();
                        hasChanges = true;
                    }
                });

                const isSidebarVisible = dom.chatSidebar.classList.contains('open');
                const wasNearBottom = (dom.chatMessages.scrollHeight - dom.chatMessages.scrollTop - dom.chatMessages.clientHeight) < 80;

                messages.forEach(msg => {
                    if (!currentMsgIds.includes(msg.id)) {
                        appendChatMessage(msg);
                        hasChanges = true;
                        
                        if (initialDataLoaded && msg.username !== currentUser.username) {
                            hasNewMessage = true;
                        }
                        
                        if (!isSidebarVisible && msg.username !== currentUser.username) {
                            unreadChatCount++;
                        }
                    } else {
                        const el = document.querySelector(`.chat-message[data-id="${msg.id}"]`);
                        if(el) {
                            const bubble = el.querySelector('.chat-msg-bubble');
                            const hasBtn = bubble.querySelector('.btn-delete-chat') !== null;
                            const shouldHaveBtn = getDeleteButtonHTML(msg) !== '';
                            if (hasBtn && !shouldHaveBtn) {
                                bubble.querySelector('.btn-delete-chat').remove();
                            }
                            const img = el.querySelector('.chat-avatar');
                            if (img) img.src = avatarsCache[msg.username] || defaultAvatarSvg;
                        }
                    }
                });

                if (hasChanges && (wasNearBottom || isSidebarVisible)) scrollChatToBottom();
                if (hasChanges) updateChatBadge();
                if (hasNewMessage) playChatSound();

                if (messages.length === 0 && !dom.chatMessages.querySelector('.chat-empty')) {
                     dom.chatMessages.innerHTML = '<p class="chat-empty">Nenhuma mensagem ainda. Seja o primeiro a dizer oi! 👋</p>';
                }
            } catch (err) { console.error("Erro ao sincronizar o chat:", err); }
        }

        function appendChatMessage(msg) {
            const emptyMsg = dom.chatMessages.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            const isOwn = currentUser && msg.username === currentUser.username;
            const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const avatarSrc = avatarsCache[msg.username] || defaultAvatarSvg;

            const div = document.createElement('div');
            div.className = `chat-message${isOwn ? ' own' : ''}`;
            div.dataset.id = msg.id; 
            div.innerHTML = `
                <img src="${avatarSrc}" class="chat-avatar" alt="Avatar">
                <div class="chat-msg-content">
                    <div class="chat-msg-user">${escapeHtml(msg.username)}<span class="chat-msg-time">${time}</span></div>
                    <div class="chat-msg-bubble">
                        <span>${escapeHtml(msg.message)}</span>
                        ${getDeleteButtonHTML(msg)}
                    </div>
                </div>
            `;
            dom.chatMessages.appendChild(div);
        }

        async function deleteChatMessage(id) {
            if (!confirm('Deseja excluir esta mensagem para todos?')) return;
            try {
                await dbClient.execute({ sql: "DELETE FROM chat_messages WHERE id = ?", args: [id] });
                fetchChatMessages();
            } catch (err) { showToast("Erro ao excluir mensagem.", "error"); }
        }

        function scrollChatToBottom() { dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight; }

        function updateChatBadge() {
            if (unreadChatCount > 0) {
                dom.chatFabBadge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount;
                dom.chatFabBadge.style.display = 'flex';
            } else {
                dom.chatFabBadge.style.display = 'none';
            }
        }

        async function handleChatSubmit(e) {
            e.preventDefault();
            const text = dom.chatInput.value.trim();
            if (!text || !currentUser || !dbClient) return;
            dom.chatInput.value = '';
            try {
                await dbClient.execute({
                    sql: "INSERT INTO chat_messages (username, message, created_at) VALUES (?, ?, ?)",
                    args: [currentUser.username, text, new Date().toISOString()]
                });
                await fetchChatMessages();
                scrollChatToBottom();
            } catch (err) { showToast("Erro ao enviar mensagem.", "error"); }
        }

        function toggleChatSidebar() {
            dom.chatSidebar.classList.toggle('open');
            if (dom.chatSidebar.classList.contains('open')) {
                unreadChatCount = 0;
                updateChatBadge();
                scrollChatToBottom();
            }
        }

        function closeChatSidebar() { dom.chatSidebar.classList.remove('open'); }

        async function fetchAllData() {
            try {
                const citiesRes = await dbClient.execute("SELECT * FROM cities");
                if (citiesRes.rows.length === 0) {
                    for (const c of DEFAULT_CITIES) {
                        await dbClient.execute({ sql: "INSERT INTO cities (name, uf, deadline, temp, emoji) VALUES (?, ?, ?, ?, ?)", args: [c.name, c.uf, c.deadline, LEGACY_TEMP_PLACEHOLDER, LEGACY_EMOJI_PLACEHOLDER] });
                    }
                    citiesState = [...DEFAULT_CITIES];
                } else { citiesState = citiesRes.rows; }

                await Promise.all(citiesState.map(async (city) => {
                    try {
                        const coords = await geocodeCity(city.name, city.uf);
                        city._lat = coords.lat;
                        city._lon = coords.lon;
                    } catch (e) {
                        city._lat = null;
                        city._lon = null;
                    }
                }));

                const alertsRes = await dbClient.execute("SELECT * FROM alerts");

                const currentTimeMs = Date.now();
                const validAlerts = [];
                let hasExpiredAlerts = false;
                let hasNewCriticalAlert = false;

                for (const alert of alertsRes.rows) {
                    const createdAtMs = alert.created_at ? new Date(alert.created_at).getTime() : currentTimeMs;
                    const durationHours = alert.duration_hours || 24;
                    const endTimeMs = createdAtMs + (durationHours * 60 * 60 * 1000);

                    if (endTimeMs <= currentTimeMs) {
                        try {
                            await dbClient.execute({ sql: "DELETE FROM alerts WHERE id = ?", args: [alert.id] });
                            hasExpiredAlerts = true;
                        } catch (err) {
                            console.error(`Erro ao deletar automaticamente o aviso ${alert.id}:`, err);
                        }
                    } else {
                        if (!knownAlertIds.has(alert.id)) {
                            knownAlertIds.add(alert.id);
                            if (initialDataLoaded && alert.color === 'red') {
                                hasNewCriticalAlert = true;
                            }
                        }
                        validAlerts.push(alert);
                    }
                }

                alertsState = validAlerts;

                if (hasExpiredAlerts) {
                    await updateTimestamp();
                }

                const metaRes = await dbClient.execute("SELECT value FROM metadata WHERE key = 'last_update'");
                updateLastUpdateText(metaRes.rows.length > 0 ? metaRes.rows[0].value : null);
                
                render();
                refreshWeatherForCities(citiesState); 
                
                if (hasNewCriticalAlert) {
                    playAlertSound();
                }
                
            } catch (err) {
                console.error("Erro ao buscar dados:", err);
                showToast("Erro ao carregar dados do banco.", "error");
            }
        }

        async function fetchUsers() {
            if (currentUser.role !== 'admin') return;
            try {
                const resPending = await dbClient.execute("SELECT username FROM support_users WHERE is_approved = 0");
                dom.pendingUsersList.innerHTML = '';
                
                if (resPending.rows.length === 0) {
                    dom.pendingUsersList.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">Nenhum usuário aguardando aprovação.</p>';
                } else {
                    resPending.rows.forEach(user => {
                        const div = document.createElement('div');
                        div.className = 'user-approval-item';
                        div.innerHTML = `
                            <span class="user-approval-name">⏳ ${user.username}</span>
                            <div style="display:flex; gap:6px;">
                                <button class="btn btn-success-outline btn-action" onclick="approveUser('${user.username}')">✔️ Aprovar</button>
                                <button class="btn btn-danger-outline btn-action" onclick="deleteUser('${user.username}')">❌ Recusar</button>
                            </div>
                        `;
                        dom.pendingUsersList.appendChild(div);
                    });
                }

                const resActive = await dbClient.execute("SELECT username, role FROM support_users WHERE is_approved = 1");
                dom.activeUsersList.innerHTML = '';
                
                if (resActive.rows.length === 0) {
                    dom.activeUsersList.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">Nenhum usuário ativo no sistema.</p>';
                } else {
                    resActive.rows.forEach(user => {
                        const div = document.createElement('div');
                        div.className = 'user-approval-item';
                        
                        let btnHtml = '';
                        if(user.username === currentUser.username) {
                            btnHtml = `<span style="font-size: 0.8rem; color: var(--text-muted); padding: 4px 10px;">(Você)</span>`;
                        } else {
                            btnHtml = `<button class="btn btn-danger-outline btn-action" onclick="deleteUser('${user.username}')">🗑️ Excluir</button>`;
                        }

                        div.innerHTML = `
                            <span class="user-approval-name">👤 ${user.username} <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted);">${user.role === 'admin' ? '(Admin)' : ''}</span></span>
                            <div style="display:flex; gap:6px;">
                                ${btnHtml}
                            </div>
                        `;
                        dom.activeUsersList.appendChild(div);
                    });
                }
            } catch(e) {
                console.error("Erro ao buscar usuários", e);
            }
        }

        async function approveUser(username) {
            try {
                await dbClient.execute({ sql: "UPDATE support_users SET is_approved = 1 WHERE username = ?", args: [username] });
                showToast(`Usuário ${username} aprovado!`, 'success');
                fetchUsers();
            } catch(e) {
                showToast(`Erro ao aprovar ${username}`, 'error');
            }
        }

        async function deleteUser(username) {
            if (!confirm(`Tem certeza que deseja recusar/excluir o usuário "${username}"?`)) return;
            try {
                await dbClient.execute({ sql: "DELETE FROM support_users WHERE username = ?", args: [username] });
                showToast(`Usuário ${username} removido!`, 'success');
                fetchUsers();
            } catch(e) {
                showToast(`Erro ao remover ${username}`, 'error');
            }
        }

        function render() {
            renderAlerts();
            const query = dom.searchInput.value.trim().toLowerCase();
            let filtered = citiesState.filter(city => city.name.toLowerCase().includes(query) || city.uf.toLowerCase().includes(query));

            filtered.sort((a, b) => { 
                const orderA = DEADLINES_CONFIG[a.deadline]?.order || 99; 
                const orderB = DEADLINES_CONFIG[b.deadline]?.order || 99; 
                if (orderA !== orderB) return orderA - orderB; 
                return a.name.localeCompare(b.name); 
            });
            
            dom.citiesContainer.innerHTML = '';
            if (filtered.length === 0) { 
                dom.citiesContainer.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:#7f8c8d; padding:40px 0;">Nenhuma cidade encontrada.</p>';
                return; 
            }
            
            const fragment = document.createDocumentFragment();
            filtered.forEach(city => { 
                const config = DEADLINES_CONFIG[city.deadline]; 
                if (!config) return; 
                const key = weatherKeyFor(city.name, city.uf);

                let weatherWidget;
                if (city._lat != null && city._lon != null) {
                    const cached = weatherCache[key];
                    const emoji = cached && cached.emoji ? cached.emoji : '⏳';
                    const tempText = cached && cached.temp !== undefined ? `${cached.temp}°C` : '...';
                    weatherWidget = `
                        <div class="city-weather" data-weather-key="${escapeHtml(key)}"
                             title="Clima em ${escapeHtml(city.name)} (atualizado automaticamente)">
                            <span class="city-weather-temp">${tempText}</span>
                            <span class="city-weather-emoji">${emoji}</span>
                        </div>`;
                } else {
                    weatherWidget = `
                        <div class="city-weather" title="Não foi possível localizar o clima desta cidade">
                            <span class="city-weather-temp">--°C</span>
                            <span class="city-weather-emoji">⚠️</span>
                        </div>`;
                }

                const card = document.createElement('div'); 
                card.className = `city-card`; 
                
                card.innerHTML = `
                    <div class="city-info">
                        <div class="city-header-row">
                            <div class="city-name-box">
                                <span class="city-name">${escapeHtml(city.name)}</span>
                                <span class="city-uf">${escapeHtml(city.uf)}</span>
                            </div>
                            ${weatherWidget}
                        </div>
                        <div class="city-divider"></div>
                        <div class="city-status ${config.colorClass}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            ${config.text}
                        </div>
                    </div>
                    <div class="city-actions">
                        <button class="btn btn-secondary btn-action btn-edit" type="button">✏️</button>
                        <button class="btn btn-danger-outline btn-action btn-delete" type="button">🗑️</button>
                    </div>
                `; 
                card.querySelector('.btn-edit').addEventListener('click', () => editCity(city.name)); 
                card.querySelector('.btn-delete').addEventListener('click', () => deleteCity(city.name, card)); 
                fragment.appendChild(card); 
            });
            dom.citiesContainer.appendChild(fragment);
        }

        function renderAlerts() {
            dom.alertsList.innerHTML = '';
            if (alertsState.length === 0) {
                dom.alertsPanel.style.display = 'none';
                return;
            }
            dom.alertsPanel.style.display = 'block';
            
            const now = Date.now();

            alertsState.forEach((alert) => {
                const item = document.createElement('div');
                const colorClass = `alert-${alert.color || 'yellow'}`;
                item.className = `alert-item ${colorClass}`;
                
                const createdAtMs = alert.created_at ? new Date(alert.created_at).getTime() : now;
                const durationHours = alert.duration_hours || 24;
                const endTimeMs = createdAtMs + (durationHours * 60 * 60 * 1000);
                
                const totalDurationMs = endTimeMs - createdAtMs;
                const elapsedMs = now - createdAtMs;
                const percent = Math.min(100, Math.max(0, (elapsedMs / totalDurationMs) * 100));
                
                const remainingMs = endTimeMs - now;
                let remainingText = '';
                if (remainingMs <= 0) {
                    remainingText = 'Expirado';
                } else {
                    const h = Math.floor(remainingMs / (1000 * 60 * 60));
                    const m = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
                    remainingText = `Expira em ${h}h e ${m}m`;
                }

                const isAuthor = currentUser && alert.username === currentUser.username;
                const authorBtnHTML = isAuthor 
                    ? `<button class="btn-delete-alert-author" onclick="deleteAlert(${alert.id}, this.closest('.alert-item'))" title="Apagar meu aviso">✖</button>` 
                    : '';

                item.innerHTML = `
                    ${authorBtnHTML}
                    <div class="alert-content-wrapper">
                        <div class="alert-title">${escapeHtml(alert.title)}</div>
                        <p class="alert-text">${escapeHtml(alert.text)}</p>
                        
                        <div class="alert-progress-wrapper">
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill" style="width: ${percent}%;"></div>
                            </div>
                            <div class="progress-bar-text">
                                <span>${percent.toFixed(0)}%</span>
                                <span>${remainingText}</span>
                            </div>
                        </div>
                    </div>
                    <div class="alert-actions">
                        <button class="btn btn-secondary btn-action" onclick="editAlert(${alert.id})">✏️</button>
                        <button class="btn btn-danger-outline btn-action" onclick="deleteAlert(${alert.id}, this.closest('.alert-item'))">🗑️</button>
                    </div>
                `;
                dom.alertsList.appendChild(item);
            });
        }

        function openQuickAlertModal() { dom.quickAlertModal.classList.add('active'); }
        function closeQuickAlertModal() { dom.quickAlertModal.classList.remove('active'); dom.quickAlertForm.reset(); }
        
        async function handleQuickAlertSubmit(e) {
            e.preventDefault();
            
            const btnSubmit = dom.quickAlertForm.querySelector('button[type="submit"]');
            const textOriginal = btnSubmit.textContent;
            btnSubmit.textContent = 'Publicando...';
            btnSubmit.disabled = true;
            
            const title = dom.qaTitle.value.trim(), text = dom.qaText.value.trim(), color = dom.qaColor.value; 
            const duration = parseInt(dom.qaDuration.value, 10) || 4;
            const createdAt = new Date().toISOString();
            const username = currentUser.username; 
            
            try {
                await dbClient.execute({ 
                    sql: "INSERT INTO alerts (title, text, color, created_at, duration_hours, username) VALUES (?, ?, ?, ?, ?, ?)", 
                    args: [title, text, color, createdAt, duration, username] 
                });
                await updateTimestamp(); 
                
                closeQuickAlertModal(); 
                showToast('Aviso rápido publicado!', 'success');
                await fetchAllData();
            } catch(err) { 
                console.error(err);
                showToast("Erro ao publicar aviso.", "error"); 
            } finally {
                btnSubmit.textContent = textOriginal;
                btnSubmit.disabled = false;
            }
        }

        function registerAppEvents() {
            dom.searchInput.removeEventListener('input', render);
            dom.btnToggleEditor.removeEventListener('click', toggleEditorMode);
            dom.btnThemeToggle.removeEventListener('click', toggleTheme);
            dom.cityForm.removeEventListener('submit', handleFormSubmit);
            dom.btnCancelEdit.removeEventListener('click', resetForm);
            dom.alertForm.removeEventListener('submit', handleAlertFormSubmit);
            dom.btnCancelAlertEdit.removeEventListener('click', resetAlertForm);
            dom.btnQuickAlert.removeEventListener('click', openQuickAlertModal);
            dom.btnCloseModal.removeEventListener('click', closeQuickAlertModal);
            dom.quickAlertForm.removeEventListener('submit', handleQuickAlertSubmit);
            dom.chatForm.removeEventListener('submit', handleChatSubmit);
            dom.btnCloseChat.removeEventListener('click', closeChatSidebar);
            dom.btnToggleChat.removeEventListener('click', toggleChatSidebar);
            
            dom.btnProfile.removeEventListener('click', openProfileModal);
            dom.btnCloseProfile.removeEventListener('click', closeProfileModal);

            dom.searchInput.addEventListener('input', render);
            dom.btnToggleEditor.addEventListener('click', toggleEditorMode);
            dom.btnThemeToggle.addEventListener('click', toggleTheme);
            dom.cityForm.addEventListener('submit', handleFormSubmit);
            dom.btnCancelEdit.addEventListener('click', resetForm);
            dom.alertForm.addEventListener('submit', handleAlertFormSubmit);
            dom.btnCancelAlertEdit.addEventListener('click', resetAlertForm);
            dom.btnQuickAlert.addEventListener('click', openQuickAlertModal);
            dom.btnCloseModal.addEventListener('click', closeQuickAlertModal);
            dom.quickAlertForm.addEventListener('submit', handleQuickAlertSubmit);
            dom.chatForm.addEventListener('submit', handleChatSubmit);
            dom.btnCloseChat.addEventListener('click', closeChatSidebar);
            dom.btnToggleChat.addEventListener('click', toggleChatSidebar);
            
            dom.btnProfile.addEventListener('click', openProfileModal);
            dom.btnCloseProfile.addEventListener('click', closeProfileModal);
        }

        function toggleEditorMode() { 
            isEditorMode = !isEditorMode; 
            if (isEditorMode) { 
                document.body.classList.add('editor-mode'); dom.btnToggleEditor.textContent = '👁️ Modo Visualização'; 
                dom.adminPanel.classList.add('active'); fetchUsers(); resetForm(); resetAlertForm();
            } else { 
                document.body.classList.remove('editor-mode'); dom.btnToggleEditor.textContent = '🛠️ Modo Editor'; 
                dom.adminPanel.classList.remove('active'); resetForm(); resetAlertForm();
            } 
            renderAlerts();
        }

        function toggleTheme() {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            setTheme(currentTheme === 'dark' ? 'light' : 'dark');
        }

        function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('ivr_tv_theme', theme);
            dom.btnThemeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        }

        function startLiveClock() {
            if (clockInterval) clearInterval(clockInterval);
            function updateClock() {
                const now = new Date();
                dom.liveTime.textContent = now.toLocaleTimeString('pt-BR');
                dom.liveDate.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            }
            updateClock();
            clockInterval = setInterval(updateClock, 1000);
        }

        async function updateTimestamp() {
            const now = new Date().toISOString();
            await dbClient.execute({ sql: "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_update', ?)", args: [now] });
        }

        function updateLastUpdateText(isoTimestamp) {
            if (isoTimestamp) {
                const dateObj = new Date(isoTimestamp);
                dom.lastUpdate.textContent = `Última atualização: ` + dateObj.toLocaleDateString('pt-BR') + ` às ` + dateObj.toLocaleTimeString('pt-BR');
            } else { dom.lastUpdate.textContent = 'Última atualização: Nunca'; }
        }

        function showToast(message, type = 'success') {
            const toast = document.createElement('div'); toast.className = `toast ${type}`;
            toast.innerHTML = `<span>${message}</span><button class="toast-close">&times;</button>`;
            toast.querySelector('.toast-close').onclick = () => toast.remove();
            dom.toastContainer.appendChild(toast);
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
        }

        function escapeHtml(text) { 
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }; 
            return text.replace(/[&<>"']/g, m => map[m]); 
        }

        async function handleFormSubmit(e) { 
            e.preventDefault(); 
            
            const btnSubmit = dom.cityForm.querySelector('button[type="submit"]');
            const textOriginal = btnSubmit.textContent;
            btnSubmit.textContent = 'Salvando...';
            btnSubmit.disabled = true;

            const name = dom.inputCityName.value.trim(), uf = dom.inputCityUf.value.trim().toUpperCase(); 
            const deadline = dom.selectDeadline.value; 
            const originalName = dom.editIndex.value; 

            if (!name || !uf) {
                btnSubmit.textContent = textOriginal;
                btnSubmit.disabled = false;
                return showToast('Preencha os campos corretamente.', 'error'); 
            }

            try {
                await geocodeCity(name, uf);
            } catch (err) {
                return showToast(`Não encontramos "${name}/${uf}" para buscar o clima. Verifique o nome e a UF.`, 'error');
            }

            try {
                if (originalName) {
                    await dbClient.execute({ 
                        sql: "UPDATE cities SET name = ?, uf = ?, deadline = ? WHERE name = ?", 
                        args: [name, uf, deadline, originalName] 
                    });
                    
                    if (originalName !== name) {
                        const oldKey = weatherKeyFor(originalName, uf);
                        delete weatherCache[oldKey];
                    }
                } else {
                    await dbClient.execute({ 
                        sql: "INSERT INTO cities (name, uf, deadline, temp, emoji) VALUES (?, ?, ?, ?, ?)", 
                        args: [name, uf, deadline, LEGACY_TEMP_PLACEHOLDER, LEGACY_EMOJI_PLACEHOLDER] 
                    });
                }

                await updateTimestamp(); 
                showToast(`Cidade "${name}" salva com sucesso!`); 
                resetForm(); 
                await fetchAllData();
            } catch (err) { 
                console.error(err);
                showToast("Erro ao salvar a cidade. Verifique se ela já existe.", "error"); 
            } finally {
                btnSubmit.textContent = textOriginal;
                btnSubmit.disabled = false;
            }
        }

        function editCity(cityName) { 
            const city = citiesState.find(c => c.name === cityName); if (!city) return; 
            dom.panelTitle.textContent = `✏️ Editar: ${city.name}`; dom.inputCityName.value = city.name; dom.inputCityUf.value = city.uf; 
            dom.selectDeadline.value = city.deadline; dom.editIndex.value = city.name; 
            dom.btnSubmitForm.textContent = 'Salvar'; dom.btnCancelEdit.style.display = 'inline-flex'; dom.adminPanel.scrollIntoView({ behavior: 'smooth' }); 
        }

        function resetForm() { 
            dom.cityForm.reset(); dom.editIndex.value = ""; dom.panelTitle.textContent = "➕ Adicionar Nova Cidade"; 
            dom.btnSubmitForm.textContent = 'Adicionar Cidade'; dom.btnCancelEdit.style.display = 'none'; 
        }

        async function deleteCity(cityName, cardElement) { 
            if (!confirm(`Excluir a cidade de ${cityName}?`)) return;
            cardElement.classList.add('removing'); 
            cardElement.addEventListener('animationend', async () => { 
                try { await dbClient.execute({ sql: "DELETE FROM cities WHERE name = ?", args: [cityName] }); await updateTimestamp(); showToast(`Cidade removida.`); await fetchAllData(); } 
                catch(err) { showToast("Erro ao deletar.", "error"); }
            }); 
        }

        async function handleAlertFormSubmit(e) {
            e.preventDefault();
            const title = dom.inputAlertTitle.value.trim(), text = dom.inputAlertText.value.trim(), color = dom.selectAlertColor.value, id = dom.alertEditIndex.value;
            const duration = parseInt(dom.selectAlertDuration.value, 10) || 24;
            const createdAt = new Date().toISOString();
            const username = currentUser.username; 
            
            try {
                if (id) {
                    await dbClient.execute({ 
                        sql: "UPDATE alerts SET title = ?, text = ?, color = ?, duration_hours = ?, created_at = ? WHERE id = ?", 
                        args: [title, text, color, duration, createdAt, parseInt(id, 10)] 
                    });
                } else {
                    await dbClient.execute({ 
                        sql: "INSERT INTO alerts (title, text, color, created_at, duration_hours, username) VALUES (?, ?, ?, ?, ?, ?)", 
                        args: [title, text, color, createdAt, duration, username] 
                    });
                }
                await updateTimestamp(); showToast('Aviso publicado!'); resetAlertForm(); await fetchAllData();
            } catch(err) { showToast("Erro ao publicar.", "error"); }
        }

        function editAlert(id) {
            const alert = alertsState.find(a => a.id === id); if (!alert) return;
            dom.alertPanelTitle.textContent = `✏️ Editar Aviso`; dom.inputAlertTitle.value = alert.title; dom.inputAlertText.value = alert.text;
            dom.selectAlertColor.value = alert.color || "yellow"; 
            dom.selectAlertDuration.value = alert.duration_hours || 24;
            dom.alertEditIndex.value = alert.id;
            dom.btnSubmitAlert.textContent = 'Salvar'; dom.btnCancelAlertEdit.style.display = 'inline-flex'; dom.adminPanel.scrollIntoView({ behavior: 'smooth' });
        }

        async function deleteAlert(id, element) {
            if (!confirm('Apagar aviso?')) return;
            element.classList.add('removing');
            element.addEventListener('animationend', async () => {
                try { await dbClient.execute({ sql: "DELETE FROM alerts WHERE id = ?", args: [id] }); await updateTimestamp(); showToast("Aviso apagado."); await fetchAllData(); } 
                catch(err) { showToast("Erro ao deletar.", "error"); }
            });
        }

        function resetAlertForm() {
            dom.alertForm.reset(); dom.alertEditIndex.value = ""; dom.alertPanelTitle.textContent = "➕ Publicar Novo Aviso";
            dom.btnSubmitAlert.textContent = "Adicionar Aviso"; dom.btnCancelAlertEdit.style.display = 'none';
        }
