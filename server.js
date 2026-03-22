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

// تعريف الأدوار
const ROLES = {
    MAFIA: { key: 'MAFIA', name: 'مافيا', icon: '🩸', colorClass: 'role-mafia-text', desc: 'أنت قاتل محترف. هدفك تصفية القرية ليلاً دون أن تُكشف هويتك في النهار.' },
    DOCTOR: { key: 'DOCTOR', name: 'طبيب', icon: '👨‍⚕️', colorClass: 'role-doctor-text', desc: 'أنت طبيب القرية. تستيقظ ليلاً لحماية لاعب واحد من الاغتيال.' },
    DETECTIVE: { key: 'DETECTIVE', name: 'محقق', icon: '🕵️‍♂️', colorClass: 'role-detective-text', desc: 'أنت محقق متخفٍ. تستيقظ ليلاً للتحقيق في هوية لاعب واحد.' },
    CITIZEN: { key: 'CITIZEN', name: 'مواطن', icon: '👤', colorClass: '', desc: 'أنت مواطن شريف. راقب تصرفات الجميع وشارك في التصويت نهاراً لطرد المافيا.' }
};

// القدرات الخاصة (المتوازنة والجديدة)
const ABILITIES = {
    MAFIA: [
        { id: 'disguise', name: 'التمويه', icon: '🎭', desc: 'تظهر كمواطن بريء إذا حقق معك المحقق هذه الليلة' },
        { id: 'blackmail', name: 'الابتزاز', icon: '🤫', desc: 'تمنع لاعب من التصويت والكلام في النهار التالي' },
        { id: 'frame', name: 'التحويل', icon: '🔄', desc: 'تلفيق التهمة: إذا حقق المحقق مع هذا اللاعب الليلة، سيظهر له بأنه "مذنب"' }
    ],
    DOCTOR: [
        { id: 'self_heal', name: 'إنقاذ الذات', icon: '💊', desc: 'تحمي نفسك من القتل هذه الليلة' },
        { id: 'autopsy', name: 'التشريح', icon: '🔬', desc: 'تكشف الوظيفة الأساسية (مافيا/طبيب/محقق/مواطن) لآخر لاعب مات' },
        { id: 'intensive_care', name: 'العناية الفائقة', icon: '💉', desc: 'تحمي اللاعب، وتبطل أي محاولة لابتزازه أو تلفيق التهمة له' }
    ],
    DETECTIVE: [
        { id: 'tracker', name: 'اقتفاء الأثر', icon: '👣', desc: 'تختار لاعباً وتعرف من هو الشخص الذي قام بزيارته (استهدافه) هذه الليلة' },
        { id: 'surveillance', name: 'المراقبة', icon: '👁️', desc: 'تراقب لاعباً وتعرف هل استخدم قدرة هذه الليلة' },
        { id: 'deep_investigate', name: 'التحقيق العميق', icon: '🔍', desc: 'تعرف الدور الكامل للاعب بدلاً من بريء/مذنب فقط' }
    ]
};

// إنشاء كود غرفة عشوائي
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);
    return code;
}

// خلط المصفوفة (Fisher-Yates)
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ========== Socket.io Events ==========
io.on('connection', (socket) => {
    console.log(`✅ متصل: ${socket.id}`);

    // --------- إنشاء غرفة ---------
    socket.on('createRoom', ({ playerName, settings }) => {
        const code = generateRoomCode();
        const room = {
            code,
            host: socket.id,
            hasHost: settings.hasHost,
            settings: {
                mafiaCount: settings.mafiaCount || 1,
                doctorCount: settings.doctorCount || 1,
                detectiveCount: settings.detectiveCount || 1,
                abilitiesEnabled: settings.abilitiesEnabled !== false,
                roleAbilities: settings.roleAbilities || { mafia: true, doctor: true, detective: true }
            },
            players: [{
                id: socket.id,
                name: playerName,
                role: null,
                isAlive: true,
                abilities: {},
                usedAbilities: {},
                isHost: settings.hasHost
            }],
            state: 'lobby',
            round: 0,
            nightActions: {},
            votes: {},
            blackmailedPlayer: null,
            framedPlayer: null,
            lastKilled: null,
            mafiaTarget: null,
            doctorTarget: null,
            detectiveTarget: null,
            nightPhase: null,
            nightResults: [],
            disguiseActive: false
        };
        rooms[code] = room;
        socket.join(code);
        socket.roomCode = code;

        socket.emit('roomCreated', { code, playerId: socket.id, isHost: settings.hasHost });
        io.to(code).emit('lobbyUpdate', getLobbyData(room));
        console.log(`🏠 غرفة أُنشئت: ${code} بواسطة ${playerName}`);
    });

    // --------- الانضمام لغرفة ---------
    socket.on('joinRoom', ({ code, playerName }) => {
        const room = rooms[code];
        if (!room) {
            socket.emit('error', { message: 'لا توجد غرفة بهذا الكود!' });
            return;
        }
        if (room.state !== 'lobby') {
            socket.emit('error', { message: 'اللعبة بدأت بالفعل!' });
            return;
        }
        if (room.players.find(p => p.name === playerName)) {
            socket.emit('error', { message: 'هذا الاسم مستخدم بالفعل!' });
            return;
        }

        room.players.push({
            id: socket.id,
            name: playerName,
            role: null,
            isAlive: true,
            abilities: {},
            usedAbilities: {},
            isHost: false
        });
        socket.join(code);
        socket.roomCode = code;

        socket.emit('joinedRoom', { code, playerId: socket.id });
        io.to(code).emit('lobbyUpdate', getLobbyData(room));
        console.log(`👤 ${playerName} انضم للغرفة ${code}`);
    });

    // --------- تحديث الإعدادات ---------
    socket.on('updateSettings', ({ mafiaCount, doctorCount, detectiveCount }) => {
        const room = rooms[socket.roomCode];
        if (!room || socket.id !== room.host) return;
        room.settings.mafiaCount = mafiaCount;
        room.settings.doctorCount = doctorCount;
        room.settings.detectiveCount = detectiveCount;
        io.to(room.code).emit('lobbyUpdate', getLobbyData(room));
    });

    // --------- بدء اللعبة ---------
    socket.on('startGame', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        if (room.hasHost && socket.id !== room.host) return;

        const playerCount = room.hasHost
            ? room.players.filter(p => !p.isHost).length
            : room.players.length;
        const { mafiaCount, doctorCount, detectiveCount } = room.settings;

        if (mafiaCount + doctorCount + detectiveCount > playerCount) {
            socket.emit('error', { message: 'عدد الأدوار الخاصة أكبر من عدد اللاعبين!' });
            return;
        }
        if (playerCount < 4) {
            socket.emit('error', { message: 'يجب أن يكون هناك 4 لاعبين على الأقل!' });
            return;
        }

        // إنشاء مجموعة الأدوار
        let roleDeck = [];
        for (let i = 0; i < mafiaCount; i++) roleDeck.push(ROLES.MAFIA);
        for (let i = 0; i < doctorCount; i++) roleDeck.push(ROLES.DOCTOR);
        for (let i = 0; i < detectiveCount; i++) roleDeck.push(ROLES.DETECTIVE);
        while (roleDeck.length < playerCount) roleDeck.push(ROLES.CITIZEN);
        shuffle(roleDeck);

        // توزيع الأدوار مع تطبيق إعدادات القدرات
        let roleIdx = 0;
        room.players.forEach(p => {
            if (room.hasHost && p.isHost) {
                p.role = { key: 'HOST', name: 'الراوي', icon: '📖', colorClass: '', desc: 'أنت مدير الجلسة.' };
                return;
            }
            p.role = roleDeck[roleIdx++];
            p.abilities = {};

            const roleKeyLow = p.role.key.toLowerCase();
            const settings = room.settings;
            const abilitiesEnabled = settings.abilitiesEnabled !== false;
            const roleAbEnabled = settings.roleAbilities ? settings.roleAbilities[roleKeyLow] !== false : true;

            if (abilitiesEnabled && roleAbEnabled && ABILITIES[p.role.key]) {
                ABILITIES[p.role.key].forEach(ab => {
                    p.abilities[ab.id] = { ...ab, available: true };
                });
            }
        });

        room.state = 'roleReveal';
        room.round = 1;

        // إرسال الدور لكل لاعب
        room.players.forEach(p => {
            const abilities = Object.values(p.abilities);
            io.to(p.id).emit('gameStarted', {
                role: p.role,
                abilities,
                players: room.players.map(pl => ({ id: pl.id, name: pl.name, isAlive: pl.isAlive })),
                isHost: p.isHost,
                hasHost: room.hasHost
            });
        });

        console.log(`🎮 اللعبة بدأت في الغرفة ${room.code}`);
    });

    // --------- اللاعب جاهز ---------
    socket.on('playerReady', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = true;

        const gamePlayers = room.hasHost
            ? room.players.filter(p => !p.isHost)
            : room.players;
        const allReady = gamePlayers.every(p => p.ready);

        if (allReady) {
            startNight(room);
        }
    });

    // --------- إجراءات الليل ---------
    socket.on('nightAction', ({ action, targetId, abilityId }) => {
        const room = rooms[socket.roomCode];
        if (!room || room.state !== 'night') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive) return;

        if (action === 'kill' && player.role.key === 'MAFIA') {
            room.mafiaTarget = targetId;
            room.nightActions[socket.id] = { action: 'kill', targetId };
        }
        else if (action === 'save' && player.role.key === 'DOCTOR') {
            room.doctorTarget = targetId;
            room.nightActions[socket.id] = { action: 'save', targetId };
        }
        else if (action === 'investigate' && player.role.key === 'DETECTIVE') {
            room.detectiveTarget = targetId;
            room.nightActions[socket.id] = { action: 'investigate', targetId };
        }

        // استخدام قدرة خاصة
        if (abilityId && player.abilities[abilityId] && player.abilities[abilityId].available) {
            player.usedAbilities[abilityId] = targetId || true;
            player.abilities[abilityId].available = false;
            room.nightActions[socket.id].abilityId = abilityId;
            room.nightActions[socket.id].abilityTarget = targetId;

            // تطبيق القدرات الفورية
            if (abilityId === 'disguise') room.disguiseActive = true;
            if (abilityId === 'blackmail') room.blackmailedPlayer = targetId;
            if (abilityId === 'frame') room.framedPlayer = targetId;
            if (abilityId === 'self_heal') {
                room.doctorTarget = socket.id;
                room.nightActions[socket.id].targetId = socket.id;
            }
        }

        // إبلاغ الهوست
        if (room.hasHost) {
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                io.to(hostPlayer.id).emit('nightActionReceived', {
                    playerName: player.name,
                    action,
                    targetName: room.players.find(p => p.id === targetId)?.name || 'نفسه',
                    abilityId
                });
            }
        }

        checkNightComplete(room);
    });

    // --------- الهوست يتقدم بالمراحل ---------
    socket.on('hostAdvance', () => {
        const room = rooms[socket.roomCode];
        if (!room || socket.id !== room.host) return;

        if (room.state === 'night') {
            resolveNight(room);
        } else if (room.state === 'day') {
            room.state = 'voting';
            io.to(room.code).emit('votingStarted', {
                players: getAlivePlayers(room),
                blackmailedPlayer: room.blackmailedPlayer
            });
        }
    });

    // --------- التصويت ---------
    socket.on('vote', ({ targetId }) => {
        const room = rooms[socket.roomCode];
        if (!room || (room.state !== 'voting' && room.state !== 'day')) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isAlive || player.isHost) return;
        if (room.blackmailedPlayer === socket.id) return;

        room.votes[socket.id] = targetId;

        const eligibleVoters = getAlivePlayers(room).filter(p => p.id !== room.blackmailedPlayer && !p.isHost);
        io.to(room.code).emit('voteUpdate', {
            votedCount: Object.keys(room.votes).length,
            totalVoters: eligibleVoters.length
        });

        if (Object.keys(room.votes).length >= eligibleVoters.length) {
            resolveVotes(room);
        }
    });

    // --------- تخطي التصويت ---------
    socket.on('skipVote', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        room.votes[socket.id] = 'skip';
        const eligibleVoters = getAlivePlayers(room).filter(p => p.id !== room.blackmailedPlayer && !p.isHost);
        
        io.to(room.code).emit('voteUpdate', {
            votedCount: Object.keys(room.votes).length,
            totalVoters: eligibleVoters.length
        });

        if (Object.keys(room.votes).length >= eligibleVoters.length) {
            resolveVotes(room);
        }
    });

    // --------- قطع الاتصال ---------
    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx === -1) return;

        const playerName = room.players[playerIdx].name;

        if (room.state === 'lobby') {
            room.players.splice(playerIdx, 1);
            if (room.players.length === 0) {
                delete rooms[code];
            } else {
                if (socket.id === room.host && room.players.length > 0) {
                    room.host = room.players[0].id;
                    room.players[0].isHost = room.hasHost;
                }
                io.to(code).emit('lobbyUpdate', getLobbyData(room));
            }
        } else {
            room.players[playerIdx].isAlive = false;
            room.players[playerIdx].disconnected = true;
            io.to(code).emit('playerDisconnected', { name: playerName });
            checkWinCondition(room);
        }
    });
});

// ========== دوال مساعدة ==========

function getLobbyData(room) {
    return {
        code: room.code,
        players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })),
        settings: room.settings,
        hasHost: room.hasHost,
        hostId: room.host
    };
}

function getAlivePlayers(room) {
    return room.players.filter(p => p.isAlive && !p.isHost);
}

function startNight(room) {
    room.state = 'night';
    room.nightActions = {};
    room.mafiaTarget = null;
    room.doctorTarget = null;
    room.detectiveTarget = null;
    room.disguiseActive = false;

    const alivePlayers = getAlivePlayers(room);

    room.players.forEach(p => {
        if (!p.isAlive && !p.isHost) return;
        const abilities = p.role && Object.keys(p.abilities).length > 0
            ? Object.values(p.abilities).filter(a => a.available)
            : [];

        io.to(p.id).emit('nightStarted', {
            round: room.round,
            role: p.role,
            abilities,
            players: alivePlayers.map(pl => ({ id: pl.id, name: pl.name })),
            isHost: p.isHost,
            isAlive: p.isAlive
        });
    });
}

function checkNightComplete(room) {
    const aliveMafia = room.players.filter(p => p.isAlive && p.role.key === 'MAFIA');
    const aliveDoctor = room.players.filter(p => p.isAlive && p.role.key === 'DOCTOR');
    const aliveDetective = room.players.filter(p => p.isAlive && p.role.key === 'DETECTIVE');

    const mafiaActed = aliveMafia.every(m => room.nightActions[m.id]);
    const doctorActed = aliveDoctor.length === 0 || aliveDoctor.every(d => room.nightActions[d.id]);
    const detectiveActed = aliveDetective.length === 0 || aliveDetective.every(d => room.nightActions[d.id]);

    if (mafiaActed && doctorActed && detectiveActed) {
        if (!room.hasHost) {
            setTimeout(() => resolveNight(room), 1500);
        } else {
            const hostPlayer = room.players.find(p => p.isHost);
            if (hostPlayer) {
                io.to(hostPlayer.id).emit('allNightActionsComplete');
            }
        }
    }
}

function resolveNight(room) {
    const results = [];
    let killed = null;

    // 1. تحديد الضحية
    if (room.mafiaTarget) {
        const target = room.players.find(p => p.id === room.mafiaTarget);
        if (target) {
            if (room.doctorTarget === room.mafiaTarget) {
                results.push({ type: 'saved', name: target.name });
            } else {
                target.isAlive = false;
                killed = target;
                room.lastKilled = target;
                results.push({ type: 'killed', name: target.name, role: target.role.name });
            }
        }
    } else {
        results.push({ type: 'noKill', message: 'الليلة مرت بسلام' });
    }

    // 2. العناية الفائقة (تنظيف الهدف من التحويل والابتزاز)
    const doctors = room.players.filter(p => p.isAlive && p.role.key === 'DOCTOR');
    doctors.forEach(doc => {
        if (doc.usedAbilities['intensive_care']) {
            const docTargetId = doc.usedAbilities['intensive_care'];
            if (room.blackmailedPlayer === docTargetId) room.blackmailedPlayer = null;
            if (room.framedPlayer === docTargetId) room.framedPlayer = null;
            io.to(doc.id).emit('intensiveCareResult', { targetName: room.players.find(p => p.id === docTargetId)?.name });
        }
    });

    // 3. نتيجة التحقيق
    if (room.detectiveTarget) {
        const target = room.players.find(p => p.id === room.detectiveTarget);
        const detectives = room.players.filter(p => p.isAlive && p.role.key === 'DETECTIVE');

        detectives.forEach(det => {
            let investigationResult;
            const usedDeep = det.usedAbilities['deep_investigate'];
            const isFramed = (room.framedPlayer === target.id);

            // منطق التحويل والتمويه
            if (target.role.key === 'MAFIA' && room.disguiseActive) {
                investigationResult = { targetName: target.name, result: 'بريء', detail: 'مواطن', disguised: true };
            } else if (isFramed) {
                investigationResult = { targetName: target.name, result: 'مذنب', detail: 'مافيا', framed: true };
            } else if (usedDeep) {
                investigationResult = { targetName: target.name, result: target.role.key === 'MAFIA' ? 'مذنب' : 'بريء', detail: target.role.name };
            } else {
                investigationResult = { targetName: target.name, result: target.role.key === 'MAFIA' ? 'مذنب' : 'بريء', detail: null };
            }
            io.to(det.id).emit('investigationResult', investigationResult);

            // اقتفاء الأثر
            if (det.usedAbilities['tracker']) {
                const trackedAction = room.nightActions[target.id];
                let visitedName = 'لم يقم بزيارة أحد';
                if (trackedAction && trackedAction.targetId) {
                    visitedName = room.players.find(p => p.id === trackedAction.targetId)?.name || visitedName;
                }
                io.to(det.id).emit('trackerResult', { targetName: target.name, visitedName });
            }

            // المراقبة
            if (det.usedAbilities['surveillance']) {
                const surveillanceTargetId = det.usedAbilities['surveillance'];
                const surveillanceTarget = room.players.find(p => p.id === surveillanceTargetId);
                const usedAbility = surveillanceTarget && room.nightActions[surveillanceTargetId]?.abilityId;
                io.to(det.id).emit('surveillanceResult', {
                    targetName: surveillanceTarget?.name,
                    usedAbility: !!usedAbility
                });
            }
        });
    }

    // 4. التشريح — يظهر الوظيفة الأساسية
    if (killed) {
        doctors.forEach(doc => {
            if (doc.usedAbilities['autopsy']) {
                io.to(doc.id).emit('autopsyResult', {
                    name: killed.name,
                    role: killed.role.name
                });
            }
        });
    }

    // مسح إعلان التحويل السري
    room.framedPlayer = null;

    // التحول للنهار
    room.state = 'day';
    room.votes = {};
    room.round++;

    // مسح القدرات المستخدمة لهذه الجولة
    room.players.forEach(p => {
        delete p.usedAbilities['tracker'];
        delete p.usedAbilities['surveillance'];
        delete p.usedAbilities['deep_investigate'];
        delete p.usedAbilities['disguise'];
        delete p.usedAbilities['frame'];
        delete p.usedAbilities['blackmail'];
        delete p.usedAbilities['intensive_care'];
        delete p.usedAbilities['autopsy'];
        delete p.usedAbilities['self_heal'];
    });

    const winResult = getWinCondition(room);

    io.to(room.code).emit('dayStarted', {
        round: room.round,
        results,
        frameAnnouncement: null,
        blackmailedPlayer: room.blackmailedPlayer,
        blackmailedName: room.blackmailedPlayer ? room.players.find(p => p.id === room.blackmailedPlayer)?.name : null,
        players: room.players.map(p => ({
            id: p.id, name: p.name, isAlive: p.isAlive,
            role: p.isAlive ? null : p.role
        })),
        gameOver: winResult ? true : false,
        winResult
    });

    // مسح الابتزاز بعد النهار
    room.blackmailedPlayer = null;

    if (winResult) {
        room.state = 'gameOver';
        io.to(room.code).emit('gameOver', {
            winner: winResult.winner,
            message: winResult.message,
            players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive }))
        });
    }
}

function resolveVotes(room) {
    const voteCounts = {};
    let skipCount = 0;
    Object.values(room.votes).forEach(targetId => {
        if (targetId === 'skip') {
            skipCount++;
        } else {
            voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
        }
    });

    let maxVotes = 0;
    let eliminated = null;
    let tie = false;

    Object.entries(voteCounts).forEach(([id, count]) => {
        if (count > maxVotes) {
            maxVotes = count;
            eliminated = id;
            tie = false;
        } else if (count === maxVotes) {
            tie = true;
        }
    });

    let result;
    if (tie || maxVotes <= skipCount || maxVotes === 0) {
        result = { type: 'noElimination', message: 'لم يتم طرد أحد — تعادل أو تخطي!' };
    } else {
        const player = room.players.find(p => p.id === eliminated);
        if (player) {
            player.isAlive = false;
            result = { type: 'eliminated', name: player.name, role: player.role };
        }
    }

    const winResult = getWinCondition(room);

    io.to(room.code).emit('voteResult', {
        result,
        voteCounts: Object.entries(voteCounts).map(([id, count]) => ({
            name: room.players.find(p => p.id === id)?.name,
            count
        })),
        skipCount,
        players: room.players.map(p => ({
            id: p.id, name: p.name, isAlive: p.isAlive,
            role: !p.isAlive ? p.role : null
        })),
        gameOver: winResult ? true : false,
        winResult
    });

    if (winResult) {
        room.state = 'gameOver';
        io.to(room.code).emit('gameOver', {
            winner: winResult.winner,
            message: winResult.message,
            players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive }))
        });
    } else {
        // الليل التالي
        room.votes = {};
        setTimeout(() => startNight(room), 3000);
    }
}

function getWinCondition(room) {
    const alive = room.players.filter(p => p.isAlive && !p.isHost);
    const aliveMafia = alive.filter(p => p.role.key === 'MAFIA').length;
    const aliveCitizens = alive.filter(p => p.role.key !== 'MAFIA').length;

    if (aliveMafia === 0) {
        return { winner: 'citizens', message: '🎉 انتصر المواطنون! تم القبض على جميع المافيا.' };
    }
    if (aliveMafia >= aliveCitizens) {
        return { winner: 'mafia', message: '🩸 انتصرت المافيا! لقد سيطروا على القرية.' };
    }
    return null;
}

function checkWinCondition(room) {
    const winResult = getWinCondition(room);
    if (winResult) {
        room.state = 'gameOver';
        io.to(room.code).emit('gameOver', {
            winner: winResult.winner,
            message: winResult.message,
            players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive }))
        });
    }
}

// ========== تشغيل السيرفر ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎮 سيرفر المافيا يعمل على:`);
    console.log(`   محلي: http://localhost:${PORT}`);
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`   شبكة: http://${net.address}:${PORT}`);
            }
        }
    }
    console.log(`\n   شارك الرابط مع اللاعبين على نفس الشبكة! 📱\n`);
});