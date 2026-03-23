const socket = io();

let state = {
    playerId: null, roomCode: null, playerName: '', isHost: false, hasHost: true,
    role: null, isAlive: true, alivePlayersList: [], abilities: [],
    selectedTarget: null, selectedAbility: null, selectedAbilityTarget: null,
    settings: { mafiaCount: 1, doctorCount: 1, detectiveCount: 1, abilitiesEnabled: true, roleAbilities: { mafia: true, doctor: true, detective: true } }
};

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
}

function goHome() { showScreen('screen-home'); }
function showCreateRoom() { const name = document.getElementById('inp-player-name').value.trim(); if (!name) return showToast('أدخل اسمك!'); state.playerName = name; showScreen('screen-create'); }
function showJoinRoom() { const name = document.getElementById('inp-player-name').value.trim(); if (!name) return showToast('أدخل اسمك!'); state.playerName = name; showScreen('screen-join'); setTimeout(() => document.querySelector('.code-digit[data-idx="0"]')?.focus(), 400); }

function setHostMode(hasHost) { state.hasHost = hasHost; document.getElementById('toggle-host').classList.toggle('active', hasHost); document.getElementById('toggle-nohost').classList.toggle('active', !hasHost); }
function adjustCount(role, delta) {
    const el = document.getElementById(`count-${role}`); let val = parseInt(el.textContent) + delta;
    if (val < 0) val = 0; if (val > 5) val = 5; if (role === 'mafia' && val < 1) val = 1;
    el.textContent = val; state.settings[`${role}Count`] = val;
}
function toggleMainAbilities() {
    state.settings.abilitiesEnabled = !state.settings.abilitiesEnabled;
    document.getElementById('toggle-abilities-main').classList.toggle('active', state.settings.abilitiesEnabled);
    document.getElementById('abilities-sub-list').classList.toggle('hidden', !state.settings.abilitiesEnabled);
}
function toggleRoleAbility(role) {
    state.settings.roleAbilities[role] = !state.settings.roleAbilities[role];
    const el = document.getElementById(`toggle-ab-${role}`);
    el.style.opacity = state.settings.roleAbilities[role] ? '1' : '0.5';
    el.querySelector('.ab-status').textContent = state.settings.roleAbilities[role] ? '✅' : '❌';
}

function onCodeInput(el) { const val = el.value.replace(/[^0-9]/g, ''); el.value = val; if (val && el.dataset.idx < 3) document.querySelector(`.code-digit[data-idx="${parseInt(el.dataset.idx) + 1}"]`)?.focus(); }
function onCodeKeydown(e, el) { if (e.key === 'Backspace' && !el.value && el.dataset.idx > 0) { const prev = document.querySelector(`.code-digit[data-idx="${parseInt(el.dataset.idx) - 1}"]`); if (prev) { prev.focus(); prev.value = ''; } } if (e.key === 'Enter') joinRoom(); }
function getCodeFromInputs() { let code = ''; document.querySelectorAll('.code-digit').forEach(el => code += el.value); return code; }

function createRoom() { socket.emit('createRoom', { playerName: state.playerName, settings: state.settings }); }
function joinRoom() { const code = getCodeFromInputs(); if (code.length !== 4) return showToast('أدخل كود الغرفة (4 أرقام)'); socket.emit('joinRoom', { code, playerName: state.playerName }); }
function startGame() { socket.emit('startGame'); }
function playerReady() { socket.emit('playerReady'); showToast('تم! في انتظار بقية اللاعبين...', 'info'); }
function copyCode() { navigator.clipboard.writeText(state.roomCode).then(() => showToast('تم نسخ الكود! 📋', 'info')); }

// ========== نظام الاستهداف المنفصل ==========
function selectTarget(targetId, groupName) {
    if (groupName.includes('ability')) state.selectedAbilityTarget = targetId;
    else state.selectedTarget = targetId;

    const container = document.getElementById(`${groupName}-targets`);
    if (!container) return;
    
    container.querySelectorAll('.target-item').forEach(el => el.classList.remove('selected', 'selected-mafia', 'selected-doctor', 'selected-detective', 'selected-ability'));
    const selected = container.querySelector(`[data-id="${targetId}"]`);
    
    if (selected) {
        let colorClass = groupName.includes('ability') ? 'selected-ability' : `selected-${groupName.split('-')[0]}`;
        selected.classList.add('selected', colorClass);
    }
}

function toggleAbility(abilityId) {
    const roleKey = state.role.key.toLowerCase();
    const container = document.getElementById(`${roleKey}-ability-container`);
    
    if (state.selectedAbility === abilityId) {
        state.selectedAbility = null;
        state.selectedAbilityTarget = null;
        document.querySelectorAll('.ability-btn').forEach(b => b.classList.remove('active-ab'));
        if (container) container.classList.add('hidden');
    } else {
        state.selectedAbility = abilityId;
        document.querySelectorAll('.ability-btn').forEach(b => b.classList.toggle('active-ab', b.dataset.id === abilityId));
        
        // هل القدرة تحتاج تحديد هدف؟
        const needsTarget = ['blackmail', 'frame', 'intensive_care', 'tracker', 'surveillance', 'deep_investigate'].includes(abilityId);
        
        if (needsTarget && container) {
            container.classList.remove('hidden');
            renderTargets(`${roleKey}-ability-targets`, state.alivePlayersList, `${roleKey}-ability`);
        } else if (container) {
            container.classList.add('hidden');
            state.selectedAbilityTarget = null;
        }
    }
}

function confirmNightAction() {
    if (!state.selectedTarget && !state.selectedAbility) return showToast('اختر هدفاً أولاً!');

    let action;
    if (state.role.key === 'MAFIA') action = 'kill';
    else if (state.role.key === 'DOCTOR') action = 'save';
    else if (state.role.key === 'DETECTIVE') action = 'investigate';

    // التحقق إذا كانت القدرة تتطلب هدفاً ولم يتم اختياره
    const needsTarget = ['blackmail', 'frame', 'intensive_care', 'tracker', 'surveillance', 'deep_investigate'].includes(state.selectedAbility);
    if (needsTarget && !state.selectedAbilityTarget) return showToast('الرجاء اختيار هدف للقدرة الخاصة!');

    socket.emit('nightAction', {
        action,
        targetId: state.selectedTarget || state.playerId, // Fallback for self abilities without main action
        abilityId: state.selectedAbility,
        abilityTargetId: state.selectedAbilityTarget
    });

    const roleKey = state.role.key.toLowerCase();
    document.getElementById(`night-${roleKey}`).classList.add('hidden');
    document.getElementById('night-waiting').classList.remove('hidden');

    state.selectedTarget = null; state.selectedAbility = null; state.selectedAbilityTarget = null;
}

function hostAdvance() { socket.emit('hostAdvance'); }

// ========== نظام التصويت المحدث ==========
function selectVoteTarget(targetId) {
    state.selectedTarget = targetId;
    document.querySelectorAll('#vote-targets .target-item').forEach(el => el.classList.toggle('selected', el.dataset.id === targetId));
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

function goToVoting() { if (state.isHost) socket.emit('hostAdvance'); else showToast('انتظر حتى ينتقل الراوي للتصويت'); }

function showToast(msg, type = 'error') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div'); toast.className = 'toast';
    if (type === 'info') toast.style.background = 'rgba(59, 130, 246, 0.9)';
    toast.textContent = msg; container.appendChild(toast); setTimeout(() => toast.remove(), 3000);
}

socket.on('roomCreated', ({ code, playerId, isHost }) => { state.roomCode = code; state.playerId = playerId; state.isHost = isHost; document.getElementById('lobby-code').textContent = code; showScreen('screen-lobby'); });
socket.on('joinedRoom', ({ code, playerId }) => { state.roomCode = code; state.playerId = playerId; document.getElementById('lobby-code').textContent = code; showScreen('screen-lobby'); });

socket.on('lobbyUpdate', ({ code, players, settings, hasHost, hostId }) => {
    state.hasHost = hasHost; const list = document.getElementById('lobby-players'); list.innerHTML = '';
    players.forEach((p, i) => {
        list.innerHTML += `<div class="player-chip" style="animation-delay: ${i * 0.05}s"><div class="player-avatar">${p.name.charAt(0)}</div><span class="player-name">${p.name}${p.id === state.playerId ? ' (أنت)' : ''}</span>${p.isHost ? '<span class="host-badge">📖 الراوي</span>' : ''}</div>`;
    });
    const canStart = (hasHost && state.playerId === hostId) || (!hasHost && state.playerId === hostId);
    document.getElementById('btn-start-game').style.display = canStart ? 'flex' : 'none';
    document.getElementById('waiting-indicator').style.display = canStart ? 'none' : 'flex';
    document.getElementById('lobby-settings').innerHTML = `<div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:8px;"><span class="role-mafia-text" style="font-weight:700;">🩸 مافيا: ${settings.mafiaCount}</span><span class="role-doctor-text" style="font-weight:700;">👨‍⚕️ طبيب: ${settings.doctorCount}</span><span class="role-detective-text" style="font-weight:700;">🕵️ محقق: ${settings.detectiveCount}</span></div>`;
});

socket.on('gameStarted', ({ role, abilities, players, isHost, hasHost }) => {
    state.role = role; state.abilities = abilities; state.isHost = isHost; state.hasHost = hasHost; state.isAlive = true;
    document.getElementById('role-icon').textContent = role.icon;
    const roleName = document.getElementById('role-name'); roleName.textContent = role.name; roleName.className = role.colorClass;
    document.getElementById('role-desc').textContent = role.desc;
    
    const abPreview = document.getElementById('abilities-preview'); abPreview.innerHTML = '';
    if (abilities.length > 0) {
        abPreview.innerHTML = '<h4 style="color:var(--warning-color);margin-bottom:10px;">⚡ قدراتك الخاصة</h4>';
        abilities.forEach(ab => abPreview.innerHTML += `<div class="ability-preview-item"><span class="ab-icon">${ab.icon}</span><span class="ab-name">${ab.name}</span><span class="ab-desc">${ab.desc}</span></div>`);
    }
    showScreen('screen-role');
});

socket.on('nightStarted', ({ round, role, abilities, players, isHost, isAlive }) => {
    state.role = role || state.role; state.isAlive = isAlive; state.alivePlayersList = players;
    document.getElementById('night-round').textContent = round;
    
    ['mafia', 'doctor', 'detective', 'citizen', 'host', 'dead'].forEach(r => document.getElementById(`night-${r}`)?.classList.add('hidden'));
    document.querySelectorAll('[id$="-ability-container"]').forEach(el => el.classList.add('hidden'));
    document.getElementById('night-waiting').classList.add('hidden');
    state.selectedTarget = null; state.selectedAbility = null; state.selectedAbilityTarget = null;

    if (isHost) {
        document.getElementById('night-host').classList.remove('hidden');
        document.getElementById('host-night-log').innerHTML = '<div class="host-log-entry">🌙 الليل بدأ — في انتظار إجراءات اللاعبين...</div>';
        document.getElementById('btn-host-advance').style.display = 'none';
        return showScreen('screen-night');
    }

    if (!isAlive) {
        document.getElementById('night-dead').classList.remove('hidden');
        document.getElementById('dead-night-log').innerHTML = '<div class="host-log-entry">🌙 الليل بدأ — أنت تراقب الأحداث كشبح 👻</div>';
        return showScreen('screen-night');
    }

    const roleKey = state.role.key;
    if (roleKey === 'MAFIA') { document.getElementById('night-mafia').classList.remove('hidden'); renderTargets('mafia-targets', players.filter(p => p.id !== state.playerId), 'mafia'); renderAbilities('mafia-abilities', abilities); }
    else if (roleKey === 'DOCTOR') { document.getElementById('night-doctor').classList.remove('hidden'); renderTargets('doctor-targets', players, 'doctor'); renderAbilities('doctor-abilities', abilities); }
    else if (roleKey === 'DETECTIVE') { document.getElementById('night-detective').classList.remove('hidden'); renderTargets('detective-targets', players.filter(p => p.id !== state.playerId), 'detective'); renderAbilities('detective-abilities', abilities); }
    else document.getElementById('night-citizen').classList.remove('hidden');

    showScreen('screen-night');
});

socket.on('nightActionReceived', ({ playerName, roleName, action, targetName, abilityName, abilityTargetName }) => {
    let actionText = '';
    if (action === 'kill') actionText = `🩸 <strong>${playerName}</strong> (${roleName}) يريد قتل <strong>${targetName}</strong>`;
    else if (action === 'save') actionText = `👨‍⚕️ <strong>${playerName}</strong> (${roleName}) يحمي <strong>${targetName}</strong>`;
    else if (action === 'investigate') actionText = `🕵️ <strong>${playerName}</strong> (${roleName}) يحقق مع <strong>${targetName}</strong>`;

    if (abilityName) {
        actionText += `<br><span style="color:var(--warning-color);font-size:0.85rem;margin-top:4px;display:block;">⚡ استخدم قدرة [${abilityName}]`;
        if (abilityTargetName) actionText += ` على <strong>${abilityTargetName}</strong>`;
        actionText += `</span>`;
    }

    const hostLog = document.getElementById('host-night-log');
    if (hostLog) hostLog.innerHTML += `<div class="host-log-entry">${actionText}</div>`;

    const deadLog = document.getElementById('dead-night-log');
    if (deadLog) deadLog.innerHTML += `<div class="host-log-entry">${actionText}</div>`;
});

socket.on('allNightActionsComplete', () => { document.getElementById('btn-host-advance').style.display = 'flex'; document.getElementById('host-night-log').innerHTML += '<div class="host-log-entry" style="border-color:var(--doctor-color)">✅ جميع اللاعبين أرسلوا إجراءاتهم</div>'; });

socket.on('dayStarted', ({ round, results, frameAnnouncement, blackmailedPlayer, blackmailedName, players, gameOver, winResult }) => {
    if (gameOver) return;
    const me = players.find(p => p.id === state.playerId);
    state.isAlive = me ? me.isAlive : false;

    document.getElementById('day-round').textContent = round;
    const resultsEl = document.getElementById('day-results'); resultsEl.innerHTML = '';
    results.forEach(r => {
        if (r.type === 'killed') resultsEl.innerHTML += `<div class="result-card killed">💀 ${r.name} قُتل هذه الليلة</div>`;
        else if (r.type === 'saved') resultsEl.innerHTML += `<div class="result-card saved">💚 شخص ما نجا من محاولة اغتيال!</div>`;
        else if (r.type === 'noKill') resultsEl.innerHTML += `<div class="result-card no-kill">✨ الليلة مرت بسلام — لم يمت أحد</div>`;
    });

    const frameEl = document.getElementById('day-frame-announcement');
    if (frameAnnouncement) { frameEl.textContent = frameAnnouncement; frameEl.classList.remove('hidden'); } else frameEl.classList.add('hidden');

    const blackmailEl = document.getElementById('blackmail-notice');
    if (blackmailedPlayer) {
        blackmailEl.textContent = blackmailedPlayer === state.playerId ? '🤫 تم ابتزازك! لا يمكنك التصويت أو الكلام' : `🤫 ${blackmailedName} تم ابتزازه — ممنوع من الكلام والتصويت`;
        blackmailEl.classList.remove('hidden');
    } else blackmailEl.classList.add('hidden');

    const playersEl = document.getElementById('day-players'); playersEl.innerHTML = '';
    players.forEach(p => {
        playersEl.innerHTML += `<div class="player-status-item ${p.isAlive ? '' : 'dead'}"><div class="status-dot"></div><span>${p.name}${p.id === state.playerId ? ' (أنت)' : ''}</span>${!p.isAlive && p.role ? `<span style="color:var(--text-muted);font-size:0.85rem;">[${p.role.name}]</span>` : ''}</div>`;
    });

    const voteBtn = document.getElementById('btn-go-vote');
    if (state.isHost) {
        voteBtn.style.display = 'flex'; voteBtn.innerHTML = '<span class="btn-icon">🗳️</span> بدء التصويت'; voteBtn.onclick = goToVoting;
    } else if (!state.hasHost && state.isAlive) { // إخفاء زر التصويت عن الموتى
        voteBtn.style.display = 'flex'; voteBtn.innerHTML = '<span class="btn-icon">🗳️</span> الانتقال للتصويت';
        voteBtn.onclick = () => {
            const container = document.getElementById('vote-targets'); container.innerHTML = ''; state.selectedTarget = null;
            if (blackmailedPlayer === state.playerId) {
                container.innerHTML = '<div class="sleeping-container"><p>🤫 أنت مُبتز — لا يمكنك التصويت</p></div>';
                document.getElementById('vote-actions-container').style.display = 'none';
            } else {
                document.getElementById('vote-actions-container').style.display = 'flex';
                document.getElementById('btn-confirm-vote').disabled = false; document.getElementById('btn-confirm-vote').textContent = 'تأكيد التصويت';
                players.forEach(p => {
                    if (p.id === state.playerId || !p.isAlive) return;
                    container.innerHTML += `<div class="target-item" data-id="${p.id}" onclick="selectVoteTarget('${p.id}')"><span>👤</span><span>${p.name}</span></div>`;
                });
            }
            showScreen('screen-voting');
        };
    } else { voteBtn.style.display = 'none'; } // إخفاء الزر كلياً للموتى

    showScreen('screen-day');
});

socket.on('votingStarted', ({ players, blackmailedPlayer }) => {
    const container = document.getElementById('vote-targets'); container.innerHTML = ''; state.selectedTarget = null;

    if (!state.isAlive && !state.isHost) { // رسالة للموتى في شاشة التصويت
        container.innerHTML = '<div class="sleeping-container"><p>👻 أنت ميت — لا يمكنك المشاركة في التصويت</p></div>';
        document.getElementById('vote-actions-container').style.display = 'none';
        return showScreen('screen-voting');
    }

    if (blackmailedPlayer === state.playerId) {
        container.innerHTML = '<div class="sleeping-container"><p>🤫 أنت مُبتز — لا يمكنك التصويت</p></div>';
        document.getElementById('vote-actions-container').style.display = 'none';
        return showScreen('screen-voting');
    }

    document.getElementById('vote-actions-container').style.display = 'flex';
    document.getElementById('btn-confirm-vote').disabled = false; document.getElementById('btn-confirm-vote').textContent = 'تأكيد التصويت';
    players.forEach(p => {
        if (p.id === state.playerId) return;
        container.innerHTML += `<div class="target-item" data-id="${p.id}" onclick="selectVoteTarget('${p.id}')"><span>👤</span><span>${p.name}</span></div>`;
    });
    showScreen('screen-voting');
});

socket.on('voteUpdate', ({ votedCount, totalVoters }) => document.getElementById('vote-progress').textContent = `صوّت ${votedCount} من ${totalVoters} لاعبين`);
socket.on('voteResult', ({ result, voteCounts, skipCount, players, gameOver, winResult }) => {
    if (gameOver) return;
    const content = document.getElementById('vote-result-content'); let html = '<div class="vote-result-box">';
    if (result.type === 'eliminated') html += `<h2>🪦 تم طرد ${result.name}</h2><p style="color:var(--text-secondary);margin-bottom:20px;">كان دوره: <span class="${result.role.colorClass}" style="font-weight:900;">${result.role.icon} ${result.role.name}</span></p>`;
    else html += `<h2>🤝 ${result.message}</h2>`;

    if (voteCounts.length > 0) {
        html += '<div class="vote-chart">'; const maxCount = Math.max(...voteCounts.map(v => v.count), skipCount || 0, 1);
        voteCounts.forEach(v => html += `<div class="vote-bar-row"><span class="vote-bar-name">${v.name}</span><div class="vote-bar"><div class="vote-bar-fill" style="width:${(v.count / maxCount) * 100}%">${v.count}</div></div></div>`);
        if (skipCount > 0) html += `<div class="vote-bar-row"><span class="vote-bar-name" style="color:var(--text-muted)">تخطي</span><div class="vote-bar"><div class="vote-bar-fill" style="width:${(skipCount / maxCount) * 100}%;background:var(--glass-bg-light)">${skipCount}</div></div></div>`;
        html += '</div>';
    }
    html += '<p style="color:var(--text-muted);margin-top:20px;">الليل قادم...</p></div>'; content.innerHTML = html;
    showScreen('screen-vote-result');
});

socket.on('gameOver', ({ winner, message, players }) => {
    const content = document.getElementById('gameover-content'); let html = `<div class="gameover-title ${winner === 'mafia' ? 'win-mafia' : 'win-citizens'}">${winner === 'mafia' ? '🩸 المافيا تنتصر!' : '🎉 المواطنون ينتصرون!'}</div><p class="gameover-message">${message}</p><div class="gameover-players">`;
    players.forEach(p => html += `<div class="gameover-player ${p.isAlive ? '' : 'dead'}"><span class="gp-name">${p.name} ${!p.isAlive ? '💀' : '✅'}</span><span class="gp-role ${p.role.colorClass}">${p.role.icon} ${p.role.name}</span></div>`);
    content.innerHTML = html + '</div>'; showScreen('screen-gameover');
});

socket.on('investigationResult', ({ targetName, result, detail, disguised, framed }) => {
    document.getElementById('day-special-info').innerHTML += `<div class="special-info-card">🕵️ نتيجة التحقيق: ${targetName} — <strong>${result}</strong>${detail ? ` (${detail})` : ''}${disguised ? ' <span style="color:var(--warning-color);">[ربما تمويه!]</span>' : ''}${framed ? ' <span style="color:var(--mafia-color);">[مشبوه بشدة!]</span>' : ''}</div>`;
});
socket.on('trackerResult', ({ targetName, visitedName }) => document.getElementById('day-special-info').innerHTML += `<div class="special-info-card">👣 اقتفاء الأثر: اللاعب <strong>${targetName}</strong> قام بزيارة <strong>${visitedName}</strong> هذه الليلة.</div>`);
socket.on('surveillanceResult', ({ targetName, usedAbility }) => document.getElementById('day-special-info').innerHTML += `<div class="special-info-card">👁️ المراقبة: ${targetName} ${usedAbility ? '<strong>استخدم قدرة</strong>' : 'لم يستخدم أي قدرة'} هذه الليلة.</div>`);
socket.on('intensiveCareResult', ({ targetName }) => document.getElementById('day-special-info').innerHTML += `<div class="special-info-card">💉 العناية الفائقة: تم حماية <strong>${targetName}</strong> من الابتزاز والتلفيق!</div>`);
socket.on('autopsyResult', ({ name, role }) => document.getElementById('day-special-info').innerHTML += `<div class="special-info-card">🔬 التشريح: الوظيفة الأساسية للاعب ${name} كانت <strong>${role}</strong></div>`);
socket.on('playerDisconnected', ({ name }) => showToast(`${name} غادر اللعبة`, 'info'));
socket.on('error', ({ message }) => showToast(message));

function renderTargets(containerId, players, groupName) {
    const container = document.getElementById(containerId);
    if (!container) return; container.innerHTML = '';
    players.forEach(p => container.innerHTML += `<div class="target-item" data-id="${p.id}" onclick="selectTarget('${p.id}', '${groupName}')"><span>👤</span><span>${p.name}</span></div>`);
}

function renderAbilities(containerId, abilities) {
    const container = document.getElementById(containerId); container.innerHTML = '';
    if (!abilities || abilities.length === 0) return;
    container.innerHTML = '<h4>⚡ القدرات الخاصة (مرة واحدة)</h4>';
    abilities.forEach(ab => container.innerHTML += `<button class="ability-btn ${ab.available ? '' : 'used'}" data-id="${ab.id}" onclick="${ab.available ? `toggleAbility('${ab.id}')` : ''}" ${!ab.available ? 'disabled' : ''}><span class="ab-icon">${ab.icon}</span><span class="ab-info"><span class="ab-name">${ab.name}</span><span class="ab-desc">${ab.desc}</span></span><span class="ab-badge">${ab.available ? 'متاح' : 'مُستخدم'}</span></button>`);
}

document.getElementById('inp-player-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const name = e.target.value.trim(); if (name) showCreateRoom(); } });