// ========== الاتصال بالسيرفر ==========
const socket = io();

// ========== حالة العميل ==========
let state = {
    playerId: null,
    roomCode: null,
    playerName: '',
    isHost: false,
    hasHost: true,
    role: null,
    abilities: [],
    selectedTarget: null,
    selectedAbility: null,
    settings: { 
        mafiaCount: 1, doctorCount: 1, detectiveCount: 1,
        abilitiesEnabled: true,
        roleAbilities: { mafia: true, doctor: true, detective: true }
    }
};

// ========== التنقل بين الشاشات ==========
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
}

function goHome() { showScreen('screen-home'); }

function showCreateRoom() {
    const name = document.getElementById('inp-player-name').value.trim();
    if (!name) return showToast('أدخل اسمك أولاً!');
    state.playerName = name;
    showScreen('screen-create');
}

function showJoinRoom() {
    const name = document.getElementById('inp-player-name').value.trim();
    if (!name) return showToast('أدخل اسمك أولاً!');
    state.playerName = name;
    showScreen('screen-join');
    // Focus first code input
    setTimeout(() => {
        const first = document.querySelector('.code-digit[data-idx="0"]');
        if (first) first.focus();
    }, 400);
}

// ========== إعدادات إنشاء الغرفة ==========
function setHostMode(hasHost) {
    state.hasHost = hasHost;
    document.getElementById('toggle-host').classList.toggle('active', hasHost);
    document.getElementById('toggle-nohost').classList.toggle('active', !hasHost);
}

function adjustCount(role, delta) {
    const el = document.getElementById(`count-${role}`);
    let val = parseInt(el.textContent) + delta;
    if (val < 0) val = 0;
    if (val > 5) val = 5;
    if (role === 'mafia' && val < 1) val = 1;
    el.textContent = val;
    state.settings[`${role}Count`] = val;
}

// ========== إعدادات القدرات الخاصة ==========
function toggleMainAbilities() {
    state.settings.abilitiesEnabled = !state.settings.abilitiesEnabled;
    const btn = document.getElementById('toggle-abilities-main');
    const subList = document.getElementById('abilities-sub-list');
    
    if (state.settings.abilitiesEnabled) {
        btn.classList.add('active');
        subList.classList.remove('hidden');
    } else {
        btn.classList.remove('active');
        subList.classList.add('hidden');
    }
}

function toggleRoleAbility(role) {
    state.settings.roleAbilities[role] = !state.settings.roleAbilities[role];
    const el = document.getElementById(`toggle-ab-${role}`);
    const status = el.querySelector('.ab-status');
    
    if (state.settings.roleAbilities[role]) {
        el.style.opacity = '1';
        status.textContent = '✅';
    } else {
        el.style.opacity = '0.5';
        status.textContent = '❌';
    }
}

// ========== إدخال كود الغرفة ==========
function onCodeInput(el) {
    const val = el.value.replace(/[^0-9]/g, '');
    el.value = val;
    if (val && el.dataset.idx < 3) {
        const next = document.querySelector(`.code-digit[data-idx="${parseInt(el.dataset.idx) + 1}"]`);
        if (next) next.focus();
    }
}

function onCodeKeydown(e, el) {
    if (e.key === 'Backspace' && !el.value && el.dataset.idx > 0) {
        const prev = document.querySelector(`.code-digit[data-idx="${parseInt(el.dataset.idx) - 1}"]`);
        if (prev) { prev.focus(); prev.value = ''; }
    }
    if (e.key === 'Enter') joinRoom();
}

function getCodeFromInputs() {
    let code = '';
    document.querySelectorAll('.code-digit').forEach(el => { code += el.value; });
    return code;
}

// ========== إنشاء غرفة ==========
function createRoom() {
    socket.emit('createRoom', {
        playerName: state.playerName,
        settings: {
            hasHost: state.hasHost,
            mafiaCount: state.settings.mafiaCount,
            doctorCount: state.settings.doctorCount,
            detectiveCount: state.settings.detectiveCount,
            abilitiesEnabled: state.settings.abilitiesEnabled,
            roleAbilities: state.settings.roleAbilities
        }
    });
}

// ========== الانضمام لغرفة ==========
function joinRoom() {
    const code = getCodeFromInputs();
    if (code.length !== 4) return showToast('أدخل كود الغرفة كاملاً (4 أرقام)');
    socket.emit('joinRoom', { code, playerName: state.playerName });
}

// ========== بدء اللعبة ==========
function startGame() {
    socket.emit('startGame');
}

// ========== اللاعب جاهز ==========
function playerReady() {
    socket.emit('playerReady');
    showToast('تم! في انتظار بقية اللاعبين...', 'info');
}

// ========== نسخ الكود ==========
function copyCode() {
    navigator.clipboard.writeText(state.roomCode).then(() => {
        showToast('تم نسخ الكود! 📋', 'info');
    }).catch(() => {
        showToast('اضغط مطولاً على الكود لنسخه');
    });
}

// ========== إجراءات الليل ==========
function selectTarget(targetId, roleKey) {
    state.selectedTarget = targetId;
    const container = document.getElementById(`${roleKey.toLowerCase()}-targets`);
    container.querySelectorAll('.target-item').forEach(el => {
        el.classList.remove('selected', 'selected-mafia', 'selected-doctor', 'selected-detective');
    });
    const selected = container.querySelector(`[data-id="${targetId}"]`);
    if (selected) {
        selected.classList.add('selected', `selected-${roleKey.toLowerCase()}`);
    }
}

function toggleAbility(abilityId) {
    if (state.selectedAbility === abilityId) {
        state.selectedAbility = null;
        document.querySelectorAll('.ability-btn').forEach(b => b.classList.remove('active-ab'));
    } else {
        state.selectedAbility = abilityId;
        document.querySelectorAll('.ability-btn').forEach(b => {
            b.classList.toggle('active-ab', b.dataset.id === abilityId);
        });
    }
}

function confirmNightAction() {
    if (!state.selectedTarget && !state.selectedAbility) {
        return showToast('اختر هدفاً أولاً!');
    }

    let action;
    if (state.role.key === 'MAFIA') action = 'kill';
    else if (state.role.key === 'DOCTOR') action = 'save';
    else if (state.role.key === 'DETECTIVE') action = 'investigate';

    // Handle self_heal for doctor
    let targetId = state.selectedTarget;
    if (state.selectedAbility === 'self_heal') {
        targetId = state.playerId;
    }

    if (!targetId) return showToast('اختر هدفاً!');

    socket.emit('nightAction', {
        action,
        targetId,
        abilityId: state.selectedAbility
    });

    // Show waiting state
    const roleKey = state.role.key.toLowerCase();
    document.getElementById(`night-${roleKey}`).classList.add('hidden');
    document.getElementById('night-waiting').classList.remove('hidden');

    state.selectedTarget = null;
    state.selectedAbility = null;
}

function hostAdvance() {
    socket.emit('hostAdvance');
}

// ========== التصويت ==========
function selectVoteTarget(targetId) {
    state.selectedTarget = targetId;
    document.querySelectorAll('#vote-targets .target-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === targetId);
    });
}

function confirmVote() {
    if (!state.selectedTarget) return showToast('اختر من تريد طرده!');
    socket.emit('vote', { targetId: state.selectedTarget });
    state.selectedTarget = null;
    document.getElementById('btn-confirm-vote').disabled = true;
    document.getElementById('btn-confirm-vote').textContent = 'تم التصويت ✅';
}

function skipVote() {
    socket.emit('skipVote');
    document.getElementById('btn-confirm-vote').disabled = true;
    document.getElementById('btn-confirm-vote').textContent = 'تم تخطي التصويت';
}

function goToVoting() {
    if (state.isHost) {
        socket.emit('hostAdvance');
    } else {
        showToast('انتظر حتى ينتقل الراوي للتصويت');
    }
}

// ========== Toast ==========
function showToast(msg, type = 'error') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'info') toast.style.background = 'rgba(59, 130, 246, 0.9)';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ========== Socket Events ==========

socket.on('roomCreated', ({ code, playerId, isHost }) => {
    state.roomCode = code;
    state.playerId = playerId;
    state.isHost = isHost;
    document.getElementById('lobby-code').textContent = code;
    showScreen('screen-lobby');
});

socket.on('joinedRoom', ({ code, playerId }) => {
    state.roomCode = code;
    state.playerId = playerId;
    document.getElementById('lobby-code').textContent = code;
    showScreen('screen-lobby');
});

socket.on('lobbyUpdate', ({ code, players, settings, hasHost, hostId }) => {
    state.hasHost = hasHost;
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';

    players.forEach((p, i) => {
        const isMe = p.id === state.playerId;
        const initials = p.name.charAt(0);
        list.innerHTML += `
            <div class="player-chip" style="animation-delay: ${i * 0.05}s">
                <div class="player-avatar">${initials}</div>
                <span class="player-name">${p.name}${isMe ? ' (أنت)' : ''}</span>
                ${p.isHost ? '<span class="host-badge">📖 الراوي</span>' : ''}
            </div>
        `;
    });

    // Show start button only for host (or first player if no host)
    const canStart = (hasHost && state.playerId === hostId) || (!hasHost && state.playerId === hostId);
    document.getElementById('btn-start-game').style.display = canStart ? 'flex' : 'none';
    document.getElementById('waiting-indicator').style.display = canStart ? 'none' : 'flex';

    // Show settings info
    const settingsEl = document.getElementById('lobby-settings');
    settingsEl.innerHTML = `
        <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:8px;">
            <span class="role-mafia-text" style="font-weight:700;">🩸 مافيا: ${settings.mafiaCount}</span>
            <span class="role-doctor-text" style="font-weight:700;">👨‍⚕️ طبيب: ${settings.doctorCount}</span>
            <span class="role-detective-text" style="font-weight:700;">🕵️ محقق: ${settings.detectiveCount}</span>
            <span style="color:var(--text-muted);">👥 اللاعبون: ${players.length}</span>
        </div>
    `;
});

socket.on('gameStarted', ({ role, abilities, players, isHost, hasHost }) => {
    state.role = role;
    state.abilities = abilities;
    state.isHost = isHost;
    state.hasHost = hasHost;

    // Show role reveal
    document.getElementById('role-icon').textContent = role.icon;
    const roleName = document.getElementById('role-name');
    roleName.textContent = role.name;
    roleName.className = role.colorClass;
    document.getElementById('role-desc').textContent = role.desc;

    // Show abilities
    const abPreview = document.getElementById('abilities-preview');
    abPreview.innerHTML = '';
    if (abilities.length > 0) {
        abPreview.innerHTML = '<h4 style="color:var(--warning-color);margin-bottom:10px;">⚡ قدراتك الخاصة</h4>';
        abilities.forEach(ab => {
            abPreview.innerHTML += `
                <div class="ability-preview-item">
                    <span class="ab-icon">${ab.icon}</span>
                    <span class="ab-name">${ab.name}</span>
                    <span class="ab-desc">${ab.desc}</span>
                </div>
            `;
        });
    }

    showScreen('screen-role');
});

socket.on('nightStarted', ({ round, role, abilities, players, isHost, isAlive }) => {
    state.role = role || state.role;
    document.getElementById('night-round').textContent = round;

    // Hide all action sections
    ['mafia', 'doctor', 'detective', 'citizen', 'host'].forEach(r => {
        document.getElementById(`night-${r}`).classList.add('hidden');
    });
    document.getElementById('night-waiting').classList.add('hidden');

    state.selectedTarget = null;
    state.selectedAbility = null;

    if (isHost) {
        // Host view
        document.getElementById('night-host').classList.remove('hidden');
        document.getElementById('host-night-log').innerHTML = '<div class="host-log-entry">🌙 الليل بدأ — في انتظار إجراءات اللاعبين...</div>';
        document.getElementById('btn-host-advance').style.display = 'none';
        showScreen('screen-night');
        return;
    }

    if (!isAlive) {
        document.getElementById('night-citizen').classList.remove('hidden');
        document.querySelector('#night-citizen p').textContent = 'لقد تم إقصاؤك... شاهد اللعبة بصمت 👻';
        showScreen('screen-night');
        return;
    }

    const roleKey = state.role.key;

    if (roleKey === 'MAFIA') {
        document.getElementById('night-mafia').classList.remove('hidden');
        renderTargets('mafia-targets', players.filter(p => p.id !== state.playerId), 'MAFIA');
        renderAbilities('mafia-abilities', abilities);
    } else if (roleKey === 'DOCTOR') {
        document.getElementById('night-doctor').classList.remove('hidden');
        renderTargets('doctor-targets', players, 'DOCTOR');
        renderAbilities('doctor-abilities', abilities);
    } else if (roleKey === 'DETECTIVE') {
        document.getElementById('night-detective').classList.remove('hidden');
        renderTargets('detective-targets', players.filter(p => p.id !== state.playerId), 'DETECTIVE');
        renderAbilities('detective-abilities', abilities);
    } else {
        document.getElementById('night-citizen').classList.remove('hidden');
    }

    showScreen('screen-night');
});

socket.on('nightActionReceived', ({ playerName, action, targetName, abilityId }) => {
    const log = document.getElementById('host-night-log');
    let actionText = '';
    if (action === 'kill') actionText = `🩸 ${playerName} يريد قتل ${targetName}`;
    else if (action === 'save') actionText = `👨‍⚕️ ${playerName} يحمي ${targetName}`;
    else if (action === 'investigate') actionText = `🕵️ ${playerName} يحقق مع ${targetName}`;
    if (abilityId) actionText += ` + استخدم قدرة: ${abilityId}`;
    log.innerHTML += `<div class="host-log-entry">${actionText}</div>`;
});

socket.on('allNightActionsComplete', () => {
    document.getElementById('btn-host-advance').style.display = 'flex';
    const log = document.getElementById('host-night-log');
    log.innerHTML += '<div class="host-log-entry" style="border-color:var(--doctor-color)">✅ جميع اللاعبين أرسلوا إجراءاتهم</div>';
});

socket.on('dayStarted', ({ round, results, frameAnnouncement, blackmailedPlayer, blackmailedName, players, gameOver, winResult }) => {
    if (gameOver) return; // gameOver event will handle this

    document.getElementById('day-round').textContent = round;

    // Render results
    const resultsEl = document.getElementById('day-results');
    resultsEl.innerHTML = '';
    results.forEach(r => {
        if (r.type === 'killed') {
            resultsEl.innerHTML += `<div class="result-card killed">💀 ${r.name} قُتل هذه الليلة</div>`;
        } else if (r.type === 'saved') {
            resultsEl.innerHTML += `<div class="result-card saved">💚 شخص ما نجا من محاولة اغتيال!</div>`;
        } else if (r.type === 'noKill') {
            resultsEl.innerHTML += `<div class="result-card no-kill">✨ الليلة مرت بسلام — لم يمت أحد</div>`;
        }
    });

    // Frame announcement
    const frameEl = document.getElementById('day-frame-announcement');
    if (frameAnnouncement) {
        frameEl.textContent = frameAnnouncement;
        frameEl.classList.remove('hidden');
    } else {
        frameEl.classList.add('hidden');
    }

    // Blackmail notice
    const blackmailEl = document.getElementById('blackmail-notice');
    if (blackmailedPlayer) {
        if (blackmailedPlayer === state.playerId) {
            blackmailEl.textContent = '🤫 تم ابتزازك! لا يمكنك التصويت أو الكلام هذه الجولة';
        } else {
            blackmailEl.textContent = `🤫 ${blackmailedName} تم ابتزازه — ممنوع من الكلام والتصويت`;
        }
        blackmailEl.classList.remove('hidden');
    } else {
        blackmailEl.classList.add('hidden');
    }

    // Players status
    const playersEl = document.getElementById('day-players');
    playersEl.innerHTML = '';
    players.forEach(p => {
        const isMe = p.id === state.playerId;
        playersEl.innerHTML += `
            <div class="player-status-item ${p.isAlive ? '' : 'dead'}">
                <div class="status-dot"></div>
                <span>${p.name}${isMe ? ' (أنت)' : ''}</span>
                ${!p.isAlive && p.role ? `<span style="color:var(--text-muted);font-size:0.85rem;">[${p.role.name}]</span>` : ''}
            </div>
        `;
    });

    // Vote button
    const voteBtn = document.getElementById('btn-go-vote');
    if (state.isHost) {
        voteBtn.style.display = 'flex';
        voteBtn.innerHTML = '<span class="btn-icon">🗳️</span> بدء التصويت';
        voteBtn.onclick = goToVoting;
    } else if (!state.hasHost) {
        voteBtn.style.display = 'flex';
        voteBtn.innerHTML = '<span class="btn-icon">🗳️</span> الانتقال للتصويت';
        voteBtn.onclick = () => {
            const container = document.getElementById('vote-targets');
            container.innerHTML = '';
            state.selectedTarget = null;

            if (blackmailedPlayer === state.playerId) {
                container.innerHTML = '<div class="sleeping-container"><p>🤫 أنت مُبتز — لا يمكنك التصويت</p></div>';
                document.getElementById('btn-confirm-vote').style.display = 'none';
            } else {
                document.getElementById('btn-confirm-vote').style.display = 'inline-block';
                document.getElementById('btn-confirm-vote').disabled = false;
                document.getElementById('btn-confirm-vote').textContent = 'تأكيد التصويت';

                players.forEach(p => {
                    if (p.id === state.playerId || !p.isAlive) return;
                    container.innerHTML += `
                        <div class="target-item" data-id="${p.id}" onclick="selectVoteTarget('${p.id}')">
                            <span>👤</span>
                            <span>${p.name}</span>
                        </div>
                    `;
                });
            }
            showScreen('screen-voting');
        };
    } else {
        voteBtn.style.display = 'none';
    }

    showScreen('screen-day');
});

socket.on('votingStarted', ({ players, blackmailedPlayer }) => {
    const container = document.getElementById('vote-targets');
    container.innerHTML = '';
    state.selectedTarget = null;

    const isBlackmailed = blackmailedPlayer === state.playerId;
    if (isBlackmailed) {
        container.innerHTML = '<div class="sleeping-container"><p>🤫 أنت مُبتز — لا يمكنك التصويت</p></div>';
        document.getElementById('btn-confirm-vote').style.display = 'none';
        showScreen('screen-voting');
        return;
    }

    document.getElementById('btn-confirm-vote').disabled = false;
    document.getElementById('btn-confirm-vote').textContent = 'تأكيد التصويت';

    players.forEach(p => {
        if (p.id === state.playerId) return;
        container.innerHTML += `
            <div class="target-item" data-id="${p.id}" onclick="selectVoteTarget('${p.id}')">
                <span>👤</span>
                <span>${p.name}</span>
            </div>
        `;
    });

    showScreen('screen-voting');
});

socket.on('voteUpdate', ({ votedCount, totalVoters }) => {
    document.getElementById('vote-progress').textContent = `صوّت ${votedCount} من ${totalVoters} لاعبين`;
});

socket.on('voteResult', ({ result, voteCounts, skipCount, players, gameOver, winResult }) => {
    if (gameOver) return;

    const content = document.getElementById('vote-result-content');
    let html = '<div class="vote-result-box">';

    if (result.type === 'eliminated') {
        html += `<h2>🪦 تم طرد ${result.name}</h2>`;
        html += `<p style="color:var(--text-secondary);margin-bottom:20px;">كان دوره: <span class="${result.role.colorClass}" style="font-weight:900;">${result.role.icon} ${result.role.name}</span></p>`;
    } else {
        html += `<h2>🤝 ${result.message}</h2>`;
    }

    // Vote chart
    if (voteCounts.length > 0) {
        html += '<div class="vote-chart">';
        const maxCount = Math.max(...voteCounts.map(v => v.count), skipCount || 0, 1);
        voteCounts.forEach(v => {
            const pct = (v.count / maxCount) * 100;
            html += `
                <div class="vote-bar-row">
                    <span class="vote-bar-name">${v.name}</span>
                    <div class="vote-bar">
                        <div class="vote-bar-fill" style="width:${pct}%">${v.count}</div>
                    </div>
                </div>
            `;
        });
        if (skipCount > 0) {
            const pct = (skipCount / maxCount) * 100;
            html += `
                <div class="vote-bar-row">
                    <span class="vote-bar-name" style="color:var(--text-muted)">تخطي</span>
                    <div class="vote-bar">
                        <div class="vote-bar-fill" style="width:${pct}%;background:var(--glass-bg-light)">${skipCount}</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
    }

    html += '<p style="color:var(--text-muted);margin-top:20px;">الليل قادم...</p>';
    html += '</div>';
    content.innerHTML = html;

    showScreen('screen-vote-result');
});

socket.on('gameOver', ({ winner, message, players }) => {
    const content = document.getElementById('gameover-content');
    let html = '';

    html += `<div class="gameover-title ${winner === 'mafia' ? 'win-mafia' : 'win-citizens'}">`;
    html += winner === 'mafia' ? '🩸 المافيا تنتصر!' : '🎉 المواطنون ينتصرون!';
    html += '</div>';
    html += `<p class="gameover-message">${message}</p>`;

    html += '<div class="gameover-players">';
    players.forEach(p => {
        html += `
            <div class="gameover-player ${p.isAlive ? '' : 'dead'}">
                <span class="gp-name">${p.name} ${!p.isAlive ? '💀' : '✅'}</span>
                <span class="gp-role ${p.role.colorClass}">${p.role.icon} ${p.role.name}</span>
            </div>
        `;
    });
    html += '</div>';

    content.innerHTML = html;
    showScreen('screen-gameover');
});

// ========== نتائج القدرات الخاصة ==========
socket.on('investigationResult', ({ targetName, result, detail, disguised, framed }) => {
    const infoEl = document.getElementById('day-special-info');
    let html = `<div class="special-info-card">🕵️ نتيجة التحقيق: ${targetName} — <strong>${result}</strong>`;
    if (detail) html += ` (${detail})`;
    if (disguised) html += ' <span style="color:var(--warning-color);">[ربما تمويه!]</span>';
    if (framed) html += ' <span style="color:var(--mafia-color);">[مشبوه بشدة!]</span>';
    html += '</div>';
    infoEl.innerHTML += html;
});

socket.on('trackerResult', ({ targetName, visitedName }) => {
    const infoEl = document.getElementById('day-special-info');
    infoEl.innerHTML += `<div class="special-info-card">👣 اقتفاء الأثر: اللاعب <strong>${targetName}</strong> قام بزيارة <strong>${visitedName}</strong> هذه الليلة.</div>`;
});

socket.on('surveillanceResult', ({ targetName, usedAbility }) => {
    const infoEl = document.getElementById('day-special-info');
    infoEl.innerHTML += `<div class="special-info-card">👁️ المراقبة: ${targetName} ${usedAbility ? '<strong>استخدم قدرة</strong> هذه الليلة' : 'لم يستخدم أي قدرة'}</div>`;
});

socket.on('intensiveCareResult', ({ targetName }) => {
    const infoEl = document.getElementById('day-special-info');
    infoEl.innerHTML += `<div class="special-info-card">💉 العناية الفائقة: تم حماية وتطهير <strong>${targetName}</strong> من أي محاولة لتلفيق التهمة أو الابتزاز!</div>`;
});

socket.on('autopsyResult', ({ name, role }) => {
    const infoEl = document.getElementById('day-special-info');
    infoEl.innerHTML += `<div class="special-info-card">🔬 التشريح: الوظيفة الأساسية للاعب ${name} كانت <strong>${role}</strong></div>`;
});

socket.on('playerDisconnected', ({ name }) => {
    showToast(`${name} غادر اللعبة`, 'info');
});

socket.on('error', ({ message }) => {
    showToast(message);
});

// ========== دوال رسم مساعدة ==========

function renderTargets(containerId, players, roleKey) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    players.forEach(p => {
        container.innerHTML += `
            <div class="target-item" data-id="${p.id}" onclick="selectTarget('${p.id}', '${roleKey}')">
                <span>👤</span>
                <span>${p.name}</span>
            </div>
        `;
    });
}

function renderAbilities(containerId, abilities) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!abilities || abilities.length === 0) return;

    container.innerHTML = '<h4>⚡ القدرات الخاصة (مرة واحدة)</h4>';
    abilities.forEach(ab => {
        const usedClass = ab.available ? '' : 'used';
        container.innerHTML += `
            <button class="ability-btn ${usedClass}" data-id="${ab.id}"
                    onclick="${ab.available ? `toggleAbility('${ab.id}')` : ''}" ${!ab.available ? 'disabled' : ''}>
                <span class="ab-icon">${ab.icon}</span>
                <span class="ab-info">
                    <span class="ab-name">${ab.name}</span>
                    <span class="ab-desc">${ab.desc}</span>
                </span>
                <span class="ab-badge">${ab.available ? 'متاح' : 'مُستخدم'}</span>
            </button>
        `;
    });
}

// ========== Auto-advance for hostless mode ==========
socket.on('votingStarted', (data) => {
    // This handles the auto-transition in hostless mode
    // The original handler above will also fire and render the voting UI
});

// ========== Enter key support ==========
document.getElementById('inp-player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const name = e.target.value.trim();
        if (name) showCreateRoom();
    }
});