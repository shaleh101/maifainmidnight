const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

// ========== بيانات الغرف في الذاكرة ==========
const rooms = {};

const ROLES = {
    MAFIA: { key: 'MAFIA', name: 'مافيا', icon: '🩸', colorClass: 'role-mafia-text', desc: 'أنت قاتل محترف. هدفك تصفية القرية ليلاً دون أن تُكشف هويتك.' },
    DOCTOR: { key: 'DOCTOR', name: 'طبيب', icon: '👨‍⚕️', colorClass: 'role-doctor-text', desc: 'أنت طبيب القرية. تستيقظ ليلاً لحماية لاعب واحد.' },
    DETECTIVE: { key: 'DETECTIVE', name: 'محقق', icon: '🕵️‍♂️', colorClass: 'role-detective-text', desc: 'أنت محقق متخفٍ. تستيقظ ليلاً للتحقيق في هوية لاعب.' },
    CITIZEN: { key: 'CITIZEN', name: 'مواطن', icon: '👤', colorClass: '', desc: 'أنت مواطن شريف. راقب تصرفات الجميع وشارك في التصويت نهاراً.' }
};

const ABILITIES = {
    MAFIA: [
        { id: 'disguise', name: 'التمويه', icon: '🎭', desc: 'تظهر كمواطن بريء للمحقق هذه الليلة' },
        { id: 'blackmail', name: 'الابتزاز', icon: '🤫', desc: 'تمنع لاعب من التصويت والكلام في النهار التالي' },
        { id: 'frame', name: 'التحويل', icon: '🔄', desc: 'تلفيق التهمة: سيظهر اللاعب كـ "مذنب" للمحقق' }
    ],
    DOCTOR: [
        { id: 'self_heal', name: 'إنقاذ الذات', icon: '💊', desc: 'تحمي نفسك من القتل هذه الليلة' },
        { id: 'autopsy', name: 'التشريح', icon: '🔬', desc: 'تكشف الوظيفة الأساسية لآخر لاعب مات' },
        { id: 'intensive_care', name: 'العناية الفائقة', icon: '💉', desc: 'تحمي اللاعب وتبطل أي ابتزاز أو تلفيق له' }
    ],
    DETECTIVE: [
        { id: 'tracker', name: 'اقتفاء الأثر', icon: '👣', desc: 'تعرف من هو الشخص الذي زاره هذا اللاعب' },
        { id: 'surveillance', name: 'المراقبة', icon: '👁️', desc: 'تعرف هل استخدم هذا اللاعب قدرة خاصة الليلة' },
        { id: 'deep_investigate', name: 'التحقيق العميق', icon: '🔍', desc: 'تعرف الدور الكامل للاعب بدلاً من بريء/مذنب' }
    ]
};

function generateRoomCode() {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms[code]);
    return code;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

io.on('connection', (socket) => {
    console.log(`✅ متصل: ${socket.id}`);

    socket.on('createRoom', ({ playerName, settings }) => {
        const code = generateRoomCode();
        const room = {
            code, host: socket.id, hasHost: settings.hasHost,
            settings: { ...settings },
            players: [{ id: socket.id, name: playerName, role: null, isAlive: true, abilities: {}, usedAbilities: {}, isHost: settings.hasHost }],
            state: 'lobby', round: 0, nightActions: {}, votes: {},
            blackmailedPlayer: null, framedPlayer: null, lastKilled: null,
            mafiaTarget: null, doctorTarget: null, detectiveTarget: null, disguiseActive: false
        };
        rooms[code] = room;
        socket.join(code);
        socket.roomCode = code;
        socket.emit('roomCreated', { code, playerId: socket.id, isHost: settings.hasHost });
        io.to(code).emit('lobbyUpdate', getLobbyData(room));
    });

    socket.on('joinRoom', ({ code, playerName }) => {
        const room = rooms[code];
        if (!room) return socket.emit('error', { message: 'الغرفة غير موجودة!' });
        if (room.state !== 'lobby') return socket.emit('error', { message: 'اللعبة بدأت بالفعل!' });
        if (room.players.find(p => p.name === playerName)) return socket.emit('error', { message: 'الاسم مستخدم!' });

        room.players.push({ id: socket.id, name: playerName, role: null, isAlive: true, abilities: {}, usedAbilities: {}, isHost: false });
        socket.join(code);
        socket.roomCode = code;
        socket.emit('joinedRoom', { code, playerId: socket.id });
        io.to(code).emit('lobbyUpdate', getLobbyData(room));
    });

    socket.on('updateSettings', (settings) => {
        const room = rooms[socket.roomCode];
        if (room && socket.id === room.host) {
            Object.assign(room.settings, settings);
            io.to(room.code).emit('lobbyUpdate', getLobbyData(room));
        }
    });

    socket.on('startGame', () => {
        const room = rooms[socket.roomCode];
        if (!room || (room.hasHost && socket.id !== room.host)) return;

        const playerCount = room.hasHost ? room.players.filter(p => !p.isHost).length : room.players.length;
        const { mafiaCount, doctorCount, detectiveCount } = room.settings;

        if (mafiaCount + doctorCount + detectiveCount > playerCount) return socket.emit('error', { message: 'الأدوار أكثر من اللاعبين!' });
        if (playerCount < 4) return socket.emit('error', { message: 'تحتاج 4 لاعبين على الأقل!' });

        let roleDeck = [];
        for (let i = 0; i < mafiaCount; i++) roleDeck.push(ROLES.MAFIA);
        for (let i = 0; i < doctorCount; i++) roleDeck.push(ROLES.DOCTOR);
        for (let i = 0; i < detectiveCount; i++) roleDeck.push(ROLES.DETECTIVE);
        while (roleDeck.length < playerCount) roleDeck.push(ROLES.CITIZEN);
        shuffle(roleDeck);

        let roleIdx = 0;
        room.players.forEach(p => {
            if (room.hasHost && p.isHost) {
                p.role = { key: 'HOST', name: 'الراوي', icon: '📖', colorClass: '', desc: 'أنت مدير الجلسة.' };
                return;
            }
            p.role = roleDeck[roleIdx++];
            p.abilities = {};
            
            const abEnabled = room.settings.abilitiesEnabled && (room.settings.roleAbilities[p.role.key.toLowerCase()] !== false);
            if (abEnabled && ABILITIES[p.role.key]) {
                ABILITIES[p.role.key].forEach(ab => { p.abilities[ab.id] = { ...ab, available: true }; });
            }
        });

        room.state = 'roleReveal';
        room.round = 1;
        room.players.forEach(p => {
            io.to(p.id).emit('gameStarted', {
                role: p.role, abilities: Object.values(p.abilities),
                players: room.players.map(pl => ({ id: pl.id, name: pl.name, isAlive: pl.isAlive })),
                isHost: p.isHost, hasHost: room.hasHost
            });
        });
    });

    socket.on('playerReady', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = true;
        
        const gamePlayers = room.hasHost ? room.players.filter(p => !p.isHost) : room.players;
        if (gamePlayers.every(p => p.ready)) startNight(room);
    });

    // ========== التعديل الرئيسي: استقبال هدف القدرة المستقل والإرسال للموتى ==========
    socket.on('nightAction', ({ action, targetId, abilityId, abilityTargetId }) => {
        const room = rooms[socket.roomCode];
        if (!room || room.state !== 'night') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive) return;

        if (action === 'kill' && player.role.key === 'MAFIA') { room.mafiaTarget = targetId; room.nightActions[socket.id] = { action: 'kill', targetId }; }
        else if (action === 'save' && player.role.key === 'DOCTOR') { room.doctorTarget = targetId; room.nightActions[socket.id] = { action: 'save', targetId }; }
        else if (action === 'investigate' && player.role.key === 'DETECTIVE') { room.detectiveTarget = targetId; room.nightActions[socket.id] = { action: 'investigate', targetId }; }

        let abilityName = null;
        if (abilityId && player.abilities[abilityId] && player.abilities[abilityId].available) {
            const finalAbilityTarget = abilityTargetId || targetId || true;
            player.usedAbilities[abilityId] = finalAbilityTarget;
            player.abilities[abilityId].available = false;
            room.nightActions[socket.id].abilityId = abilityId;
            room.nightActions[socket.id].abilityTarget = finalAbilityTarget;
            abilityName = player.abilities[abilityId].name;

            if (abilityId === 'disguise') room.disguiseActive = true;
            if (abilityId === 'blackmail') room.blackmailedPlayer = finalAbilityTarget;
            if (abilityId === 'frame') room.framedPlayer = finalAbilityTarget;
            if (abilityId === 'self_heal') { room.doctorTarget = socket.id; room.nightActions[socket.id].targetId = socket.id; }
        }

        // إبلاغ الهوست والموتى (شاشة الميت)
        const observers = room.players.filter(p => p.isHost || (!p.isAlive && !p.disconnected));
        observers.forEach(obs => {
            io.to(obs.id).emit('nightActionReceived', {
                playerName: player.name,
                roleName: player.role.name,
                action,
                targetName: room.players.find(p => p.id === targetId)?.name || 'نفسه',
                abilityName,
                abilityTargetName: abilityTargetId ? room.players.find(p => p.id === abilityTargetId)?.name : null
            });
        });

        checkNightComplete(room);
    });

    socket.on('hostAdvance', () => {
        const room = rooms[socket.roomCode];
        if (!room || socket.id !== room.host) return;
        if (room.state === 'night') resolveNight(room);
        else if (room.state === 'day') {
            room.state = 'voting';
            io.to(room.code).emit('votingStarted', { players: getAlivePlayers(room), blackmailedPlayer: room.blackmailedPlayer });
        }
    });

    socket.on('vote', ({ targetId }) => {
        const room = rooms[socket.roomCode];
        if (!room || (room.state !== 'voting' && room.state !== 'day')) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive || player.isHost || room.blackmailedPlayer === socket.id) return;

        room.votes[socket.id] = targetId;
        checkVotes(room);
    });

    socket.on('skipVote', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive || player.isHost || room.blackmailedPlayer === socket.id) return;

        room.votes[socket.id] = 'skip';
        checkVotes(room);
    });

    socket.on('disconnect', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        const idx = room.players.findIndex(p => p.id === socket.id);
        if (idx === -1) return;

        if (room.state === 'lobby') {
            room.players.splice(idx, 1);
            if (room.players.length === 0) delete rooms[socket.roomCode];
            else {
                if (socket.id === room.host) { room.host = room.players[0].id; room.players[0].isHost = room.hasHost; }
                io.to(room.code).emit('lobbyUpdate', getLobbyData(room));
            }
        } else {
            room.players[idx].isAlive = false;
            room.players[idx].disconnected = true;
            io.to(room.code).emit('playerDisconnected', { name: room.players[idx].name });
            checkWinCondition(room);
        }
    });
});

function getLobbyData(room) {
    return { code: room.code, players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })), settings: room.settings, hasHost: room.hasHost, hostId: room.host };
}

function getAlivePlayers(room) { return room.players.filter(p => p.isAlive && !p.isHost); }

function checkVotes(room) {
    const eligibleVoters = getAlivePlayers(room).filter(p => p.id !== room.blackmailedPlayer);
    io.to(room.code).emit('voteUpdate', { votedCount: Object.keys(room.votes).length, totalVoters: eligibleVoters.length });
    if (Object.keys(room.votes).length >= eligibleVoters.length) resolveVotes(room);
}

function startNight(room) {
    room.state = 'night';
    room.nightActions = {}; room.mafiaTarget = null; room.doctorTarget = null; room.detectiveTarget = null; room.disguiseActive = false;
    room.players.forEach(p => p.ready = false);
    
    room.players.forEach(p => {
        const abilities = p.role && Object.keys(p.abilities).length > 0 ? Object.values(p.abilities).filter(a => a.available) : [];
        io.to(p.id).emit('nightStarted', { round: room.round, role: p.role, abilities, players: getAlivePlayers(room).map(pl => ({ id: pl.id, name: pl.name })), isHost: p.isHost, isAlive: p.isAlive });
    });
}

function checkNightComplete(room) {
    const act = (roleKey) => {
        const alive = room.players.filter(p => p.isAlive && p.role.key === roleKey);
        return alive.length === 0 || alive.every(p => room.nightActions[p.id]);
    };
    if (act('MAFIA') && act('DOCTOR') && act('DETECTIVE')) {
        if (!room.hasHost) setTimeout(() => resolveNight(room), 1500);
        else io.to(room.host).emit('allNightActionsComplete');
    }
}

function resolveNight(room) {
    const results = []; let killed = null;

    if (room.mafiaTarget) {
        const target = room.players.find(p => p.id === room.mafiaTarget);
        if (target) {
            if (room.doctorTarget === room.mafiaTarget) results.push({ type: 'saved', name: target.name });
            else {
                target.isAlive = false; killed = target; room.lastKilled = target;
                results.push({ type: 'killed', name: target.name, role: target.role.name });
            }
        }
    } else results.push({ type: 'noKill', message: 'الليلة مرت بسلام' });

    const doctors = room.players.filter(p => p.isAlive && p.role.key === 'DOCTOR');
    doctors.forEach(doc => {
        if (doc.usedAbilities['intensive_care']) {
            const tid = doc.usedAbilities['intensive_care'];
            if (room.blackmailedPlayer === tid) room.blackmailedPlayer = null;
            if (room.framedPlayer === tid) room.framedPlayer = null;
            io.to(doc.id).emit('intensiveCareResult', { targetName: room.players.find(p => p.id === tid)?.name });
        }
    });

    if (room.detectiveTarget) {
        const target = room.players.find(p => p.id === room.detectiveTarget);
        room.players.filter(p => p.isAlive && p.role.key === 'DETECTIVE').forEach(det => {
            const usedDeep = det.usedAbilities['deep_investigate'];
            const isFramed = (room.framedPlayer === target.id);
            let res;

            if (target.role.key === 'MAFIA' && room.disguiseActive) res = { targetName: target.name, result: 'بريء', detail: 'مواطن', disguised: true };
            else if (isFramed) res = { targetName: target.name, result: 'مذنب', detail: 'مافيا', framed: true };
            else if (usedDeep) res = { targetName: target.name, result: target.role.key === 'MAFIA' ? 'مذنب' : 'بريء', detail: target.role.name };
            else res = { targetName: target.name, result: target.role.key === 'MAFIA' ? 'مذنب' : 'بريء', detail: null };
            io.to(det.id).emit('investigationResult', res);

            if (det.usedAbilities['tracker']) {
                const tracked = room.nightActions[det.usedAbilities['tracker']];
                const visitedName = tracked && tracked.targetId ? room.players.find(p => p.id === tracked.targetId)?.name : 'لم يقم بزيارة أحد';
                io.to(det.id).emit('trackerResult', { targetName: room.players.find(p=>p.id===det.usedAbilities['tracker'])?.name, visitedName });
            }
            if (det.usedAbilities['surveillance']) {
                const tid = det.usedAbilities['surveillance'];
                io.to(det.id).emit('surveillanceResult', { targetName: room.players.find(p=>p.id===tid)?.name, usedAbility: !!room.nightActions[tid]?.abilityId });
            }
        });
    }

    if (killed) doctors.forEach(doc => { if (doc.usedAbilities['autopsy']) io.to(doc.id).emit('autopsyResult', { name: killed.name, role: killed.role.name }); });

    room.framedPlayer = null; room.state = 'day'; room.votes = {}; room.round++;
    room.players.forEach(p => p.usedAbilities = {});
    const winResult = getWinCondition(room);

    io.to(room.code).emit('dayStarted', {
        round: room.round, results, frameAnnouncement: null,
        blackmailedPlayer: room.blackmailedPlayer, blackmailedName: room.blackmailedPlayer ? room.players.find(p => p.id === room.blackmailedPlayer)?.name : null,
        players: room.players.map(p => ({ id: p.id, name: p.name, isAlive: p.isAlive, role: p.isAlive ? null : p.role })),
        gameOver: !!winResult, winResult
    });

    room.blackmailedPlayer = null;
    if (winResult) io.to(room.code).emit('gameOver', { winner: winResult.winner, message: winResult.message, players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive })) });
}

function resolveVotes(room) {
    const counts = {}; let skips = 0;
    Object.values(room.votes).forEach(v => { if (v === 'skip') skips++; else counts[v] = (counts[v] || 0) + 1; });

    let max = 0, elim = null, tie = false;
    Object.entries(counts).forEach(([id, c]) => {
        if (c > max) { max = c; elim = id; tie = false; } else if (c === max) tie = true;
    });

    let result;
    if (tie || max <= skips || max === 0) result = { type: 'noElimination', message: 'لم يتم طرد أحد — تعادل أو تخطي!' };
    else {
        const p = room.players.find(p => p.id === elim);
        p.isAlive = false; result = { type: 'eliminated', name: p.name, role: p.role };
    }

    const winResult = getWinCondition(room);
    io.to(room.code).emit('voteResult', {
        result, voteCounts: Object.entries(counts).map(([id, count]) => ({ name: room.players.find(p => p.id === id)?.name, count })), skipCount: skips,
        players: room.players.map(p => ({ id: p.id, name: p.name, isAlive: p.isAlive, role: !p.isAlive ? p.role : null })),
        gameOver: !!winResult, winResult
    });

    if (winResult) io.to(room.code).emit('gameOver', { winner: winResult.winner, message: winResult.message, players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive })) });
    else { room.votes = {}; setTimeout(() => startNight(room), 3500); }
}

function getWinCondition(room) {
    const alive = getAlivePlayers(room);
    const mafia = alive.filter(p => p.role.key === 'MAFIA').length;
    if (mafia === 0) return { winner: 'citizens', message: '🎉 انتصر المواطنون! تم القبض على جميع المافيا.' };
    if (mafia >= alive.length - mafia) return { winner: 'mafia', message: '🩸 انتصرت المافيا! لقد سيطروا على القرية.' };
    return null;
}
function checkWinCondition(room) {
    const win = getWinCondition(room);
    if (win) { room.state = 'gameOver'; io.to(room.code).emit('gameOver', { winner: win.winner, message: win.message, players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive })) }); }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🎮 Server running on port ${PORT}`));