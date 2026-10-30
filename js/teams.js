/**
 * js/teams.js
 * Gestion de l'état multi-club, durées de créneaux modulables, import différentiel interactif (Diff Viewer)
 * avec actions groupées, assignation tactile des poules sur mobile, sauvegarde (.json) et export .ics.
 */

let appData = { club: {}, teams: [], matches: [] };
let customOverrides = JSON.parse(localStorage.getItem('espm_overrides') || '{}');
let teamGroups = JSON.parse(localStorage.getItem('espm_team_groups') || 'null');
let conflictingGymMatchIds = new Set();
let conflictingCoachMatchIds = new Set();
let draggedPoolId = null;
let pendingImportPayload = null;

const DEFAULT_GROUP_RULES = [
    { id: 'GRP_SF1', name: 'Seniors Filles 1 (RF2)', duration: 150, match: (div) => /^RF2$/i.test(div) },
    { id: 'GRP_SF2', name: 'Seniors Filles 2 (PRF)', duration: 120, match: (div) => /^PRF$/i.test(div) || /^CDF/i.test(div) },
    { id: 'GRP_SM1', name: 'Seniors Garçons 1 (DM3)', duration: 120, match: (div) => /^DM3$/i.test(div) || /^CDM/i.test(div) },
    { id: 'GRP_SM2', name: 'Seniors Garçons 2 (DM4)', duration: 120, match: (div) => /^DM4$/i.test(div) },
    { id: 'GRP_U18F', name: 'U18 Féminines', duration: 120, match: (div) => /U18F/i.test(div) || /^RFU18/i.test(div) },
    { id: 'GRP_U18M', name: 'U18 Masculins', duration: 120, match: (div) => /U18M/i.test(div) },
    { id: 'GRP_U15F', name: 'U15 Féminines', duration: 120, match: (div) => /U15F/i.test(div) },
    { id: 'GRP_U15M', name: 'U15 Masculins', duration: 120, match: (div) => /U15M/i.test(div) },
    { id: 'GRP_U13F', name: 'U13 Féminines', duration: 120, match: (div) => /U13F/i.test(div) },
    { id: 'GRP_U13M1', name: 'U13 Masculins 1 (Élite)', duration: 120, match: (div) => /U13M.*ELITE/i.test(div) },
    { id: 'GRP_U13M2', name: 'U13 Masculins 2 (Initié)', duration: 120, match: (div) => /U13M.*BI/i.test(div) || (/U13M/i.test(div) && !/ELITE/i.test(div)) },
    { id: 'GRP_U11M', name: 'U11 Masculins', duration: 75, match: (div) => /U11/i.test(div) && !/DFU11|U11F/i.test(div) },
    { id: 'GRP_U11F', name: 'U11 Féminines', duration: 75, match: (div) => /DFU11|U11F/i.test(div) },
    { id: 'GRP_U9', name: 'U9 Mini-Basket', duration: 75, match: (div) => /U9|U7/i.test(div) }
];

function slugifyId(str) {
    return String(str || 'EQUIPE').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
}

function makeMatchKey(teamId, matchNum) {
    const cleanNum = String(matchNum || '').trim();
    if (cleanNum.startsWith(teamId + '__')) return cleanNum;
    return `${teamId}__${cleanNum}`;
}

function getMatchDuration(m) {
    return Number(m.duration) || 120;
}

function formatDurationLabel(mins) {
    const num = Number(mins) || 120;
    const h = Math.floor(num / 60);
    const m = num % 60;
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h00`;
}

function getMapsUrl(salle) {
    const clean = String(salle || '').trim();
    if (!clean || clean === 'Gymnase principal du club' || clean === 'Salle extérieure') {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean || 'Gymnase')}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;
}

function updateClubHeaderUI() {
    const titleEl = document.getElementById('header-club-name');
    const subEl = document.getElementById('header-club-sub');
    if (appData.matches && appData.matches.length > 0) {
        let clubName = appData.club?.nom;
        if (!clubName || clubName === 'Mon Club') {
            const homeMatches = appData.matches.filter(m => m.isHome);
            if (homeMatches.length > 0 && homeMatches[0].equipe1) {
                clubName = homeMatches[0].equipe1.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*-\s*\d+\s*$/, '').trim();
            }
        }
        if (titleEl) titleEl.textContent = clubName || "Sport Planner — Club Basket";
        if (subEl) subEl.textContent = `${appData.matches.length} rencontres • ${appData.teams.length} poules FBI`;
    } else {
        if (titleEl) titleEl.textContent = "Sport Planner — Club Basket";
        if (subEl) subEl.textContent = "Planificateur de salles, coachs & dérogations FBI";
    }
}

function buildOrSyncTeamGroups(forceReset = false) {
    if (forceReset || !teamGroups || !Array.isArray(teamGroups.groups)) {
        teamGroups = { groups: [], poolToGroup: {} };
    }

    const existingGroupsMap = new Map(teamGroups.groups.map(g => [g.id, g]));

    appData.teams.forEach(rawTeam => {
        const poolId = rawTeam.id;
        const divLabel = rawTeam.label;

        if (!forceReset && (poolId in teamGroups.poolToGroup)) {
            const assignedGid = teamGroups.poolToGroup[poolId];
            if (assignedGid === null || existingGroupsMap.has(assignedGid)) {
                return;
            }
        }

        const matchedRule = DEFAULT_GROUP_RULES.find(r => r.match(divLabel));
        if (matchedRule) {
            if (!existingGroupsMap.has(matchedRule.id)) {
                existingGroupsMap.set(matchedRule.id, {
                    id: matchedRule.id,
                    name: matchedRule.name,
                    defaultCoach: '',
                    defaultDuration: matchedRule.duration || 120
                });
            }
            teamGroups.poolToGroup[poolId] = matchedRule.id;
        } else {
            const fallbackId = 'GRP_' + poolId;
            if (!existingGroupsMap.has(fallbackId)) {
                existingGroupsMap.set(fallbackId, {
                    id: fallbackId,
                    name: divLabel,
                    defaultCoach: '',
                    defaultDuration: /U11|U9|U7/i.test(divLabel) ? 75 : 120
                });
            }
            teamGroups.poolToGroup[poolId] = fallbackId;
        }
    });

    teamGroups.groups = Array.from(existingGroupsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
}

function syncMatchesWithTeamGroups() {
    if (!teamGroups) return;
    const groupsMap = new Map(teamGroups.groups.map(g => [g.id, g]));

    appData.matches.forEach(m => {
        const gid = teamGroups.poolToGroup[m.teamId];
        const grp = gid ? groupsMap.get(gid) : null;
        if (grp) {
            m.groupId = grp.id;
            m.groupName = grp.name;
            if (!m.coach && grp.defaultCoach) {
                m.coach = grp.defaultCoach;
            }
            if (!m.duration) {
                m.duration = grp.defaultDuration || 120;
            }
        } else {
            m.groupId = 'UNASSIGNED_' + m.teamId;
            m.groupName = m.teamLabel;
            if (!m.duration) m.duration = 120;
        }
    });
}

function getPoolsForGroup(groupId) {
    if (!teamGroups) return [];
    return appData.teams.filter(t => teamGroups.poolToGroup[t.id] === groupId);
}

function openTeamsModal() {
    renderTeamsModalContent();
    document.getElementById('teams-modal').classList.remove('hidden');
}

function closeTeamsModal() {
    document.getElementById('teams-modal').classList.add('hidden');
    syncMatchesWithTeamGroups();
    initTeamFilter();
    detectConflictsAndDerogations();
    renderView();
}

function assignPoolSelect(poolId, targetGroupId) {
    if (!poolId) return;
    teamGroups.poolToGroup[poolId] = targetGroupId === 'UNASSIGNED' ? null : targetGroupId;
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
    renderTeamsModalContent();
}

function renderPoolChipHTML(pool, isAssigned) {
    const count = appData.matches.filter(m => m.teamId === pool.id).length;
    const currentGid = teamGroups?.poolToGroup?.[pool.id] || 'UNASSIGNED';
    const groupOptions = (teamGroups?.groups || []).map(g =>
        `<option value="${g.id}" ${currentGid === g.id ? 'selected' : ''}>→ ${g.name}</option>`
    ).join('');

    return `
        <div draggable="true"
             ondragstart="handlePoolDragStart(event, '${pool.id}')"
             ondragend="handlePoolDragEnd(event)"
             class="pool-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shadow-sm ${
                 isAssigned
                     ? 'bg-indigo-950/90 text-indigo-200 border-indigo-700/80 hover:border-indigo-500'
                     : 'bg-amber-950/90 text-amber-200 border-amber-700/80 hover:border-amber-500'
             }">
            <i class="fa-solid fa-grip-vertical text-[10px] opacity-60 hidden md:inline"></i>
            <span>${pool.label}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-neutral-300 font-mono">${count}m</span>
            <!-- Sélecteur tactile mobile pour affecter une poule sans Drag & Drop -->
            <select onchange="assignPoolSelect('${pool.id}', this.value)"
                    class="md:hidden bg-black/60 text-[10px] text-white border border-neutral-600 rounded px-1 py-0.5 max-w-[110px]">
                <option value="UNASSIGNED" ${!isAssigned ? 'selected' : ''}>Réserve</option>
                ${groupOptions}
            </select>
            ${isAssigned ? `
                <button type="button" onclick="unassignPool('${pool.id}')" title="Retirer de cette équipe" class="ml-0.5 text-neutral-400 hover:text-rose-400 transition">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            ` : ''}
        </div>
    `;
}

function renderTeamsModalContent() {
    const unassignedZone = document.getElementById('unassigned-pools-zone');
    const unassignedCountEl = document.getElementById('unassigned-pools-count');
    const tableBody = document.getElementById('teams-dnd-table-body');
    if (!unassignedZone || !tableBody) return;

    if (!appData.teams || appData.teams.length === 0) {
        unassignedZone.innerHTML = `<span class="text-xs text-neutral-500 italic">Importez d'abord votre fichier Excel FBI (.xlsx).</span>`;
        if (unassignedCountEl) unassignedCountEl.textContent = "0 poule";
        tableBody.innerHTML = `<tr class="block md:table-row"><td colspan="6" class="py-8 text-center text-neutral-500 block md:table-cell">Aucune donnée chargée.</td></tr>`;
        return;
    }

    const validGroupIds = new Set(teamGroups.groups.map(g => g.id));
    const unassignedPools = appData.teams.filter(p => {
        const gid = teamGroups.poolToGroup[p.id];
        return !gid || !validGroupIds.has(gid);
    });

    if (unassignedCountEl) unassignedCountEl.textContent = `${unassignedPools.length} poule(s) en réserve`;

    if (unassignedPools.length === 0) {
        unassignedZone.innerHTML = `
            <span class="text-xs text-emerald-400/90 font-medium flex items-center gap-1.5 py-1">
                <i class="fa-solid fa-circle-check"></i> Toutes les poules FBI sont rattachées à une équipe !
            </span>`;
    } else {
        unassignedZone.innerHTML = unassignedPools.map(p => renderPoolChipHTML(p, false)).join('');
    }

    if (teamGroups.groups.length === 0) {
        tableBody.innerHTML = `
            <tr class="block md:table-row">
                <td colspan="6" class="py-10 text-center text-neutral-400 block md:table-cell">
                    Aucune équipe créée. Utilisez le champ ci-dessus ou cliquez sur <b>« Regroupement auto »</b>.
                </td>
            </tr>`;
        return;
    }

    const durationOptions = [
        { val: 60, label: '1h00 (Plateau)' },
        { val: 75, label: '1h15 (U9/U11)' },
        { val: 90, label: '1h30 (Jeunes)' },
        { val: 105, label: '1h45' },
        { val: 120, label: '2h00 (Standard)' },
        { val: 150, label: '2h30 (Région)' },
        { val: 180, label: '3h00 (Tournoi)' }
    ];

    tableBody.innerHTML = teamGroups.groups.map(grp => {
        const attachedPools = getPoolsForGroup(grp.id);
        const groupMatches = appData.matches.filter(m => attachedPools.some(p => p.id === m.teamId));
        const homeCount = groupMatches.filter(m => m.isHome).length;
        const awayCount = groupMatches.length - homeCount;
        const grpDur = Number(grp.defaultDuration) || 120;

        return `
            <tr class="flex flex-col md:table-row p-3 md:p-0 gap-2 md:gap-0 hover:bg-[#1a1a1a] transition">
                <td class="md:py-3 md:px-4 align-middle block md:table-cell">
                    <input type="text" value="${grp.name}"
                           onchange="renameTeamGroup('${grp.id}', this.value)"
                           class="w-full bg-[#1e1e1e] border border-neutral-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white focus:outline-none">
                </td>
                <td class="md:py-3 md:px-4 align-middle block md:table-cell">
                    <input type="text" value="${grp.defaultCoach || ''}"
                           placeholder="Coach..."
                           onchange="updateGroupCoach('${grp.id}', this.value)"
                           class="w-full bg-[#1e1e1e] border border-neutral-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none">
                </td>
                <td class="md:py-3 md:px-4 align-middle block md:table-cell">
                    <select onchange="updateGroupDuration('${grp.id}', this.value)"
                            class="w-full bg-[#1e1e1e] border border-neutral-700 focus:border-indigo-500 rounded-lg px-2 py-1.5 text-xs text-neutral-200 focus:outline-none">
                        ${durationOptions.map(o => `<option value="${o.val}" ${grpDur === o.val ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </td>
                <td class="md:py-2.5 md:px-4 align-middle block md:table-cell"
                    ondragover="handlePoolDragOver(event)"
                    ondragleave="handlePoolDragLeave(event)"
                    ondrop="handlePoolDrop(event, '${grp.id}')">
                    <div class="dropzone-area min-h-[42px] p-2 rounded-xl border-2 border-dashed border-neutral-700/80 bg-[#121212]/60 flex flex-wrap items-center gap-2">
                        ${attachedPools.length > 0
                            ? attachedPools.map(p => renderPoolChipHTML(p, true)).join('')
                            : `<span class="text-[11px] text-neutral-500 italic pointer-events-none select-none"><i class="fa-solid fa-arrow-down-long mr-1"></i>Glissez ou sélectionnez une poule...</span>`
                        }
                    </div>
                </td>
                <td class="md:py-3 md:px-4 align-middle flex md:table-cell items-center justify-between md:text-center whitespace-nowrap">
                    <span class="font-bold text-white text-xs">${groupMatches.length} match(s)</span>
                    <span class="text-[10px] text-neutral-400 md:block">🏠 ${homeCount} dom. / ✈️ ${awayCount} ext.</span>
                </td>
                <td class="md:py-3 md:px-4 align-middle text-right block md:table-cell">
                    <button onclick="deleteTeamGroup('${grp.id}')" title="Supprimer cette équipe"
                            class="p-1.5 px-2.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-950/40 transition text-xs">
                        <i class="fa-solid fa-trash-can"></i> <span class="md:hidden ml-1">Supprimer l'équipe</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function handlePoolDragStart(event, poolId) {
    draggedPoolId = poolId;
    event.dataTransfer.setData('text/plain', poolId);
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
        if (event.target && event.target.classList) {
            event.target.classList.add('dragging');
        }
    }, 0);
}

function handlePoolDragEnd(event) {
    draggedPoolId = null;
    if (event.target && event.target.classList) {
        event.target.classList.remove('dragging');
    }
    document.querySelectorAll('.dropzone-active').forEach(el => el.classList.remove('dropzone-active'));
}

function handlePoolDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const zone = event.currentTarget.classList.contains('dropzone-area')
        ? event.currentTarget
        : event.currentTarget.querySelector('.dropzone-area');
    if (zone) zone.classList.add('dropzone-active');
}

function handlePoolDragLeave(event) {
    const zone = event.currentTarget.classList.contains('dropzone-area')
        ? event.currentTarget
        : event.currentTarget.querySelector('.dropzone-area');
    if (zone) zone.classList.remove('dropzone-active');
}

function handlePoolDrop(event, targetGroupId) {
    event.preventDefault();
    const poolId = draggedPoolId || event.dataTransfer.getData('text/plain');
    document.querySelectorAll('.dropzone-active').forEach(el => el.classList.remove('dropzone-active'));

    if (!poolId) return;

    if (targetGroupId === 'UNASSIGNED') {
        teamGroups.poolToGroup[poolId] = null;
    } else {
        teamGroups.poolToGroup[poolId] = targetGroupId;
    }

    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
    renderTeamsModalContent();
}

function unassignPool(poolId) {
    teamGroups.poolToGroup[poolId] = null;
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
    renderTeamsModalContent();
}

function unassignAllPools() {
    appData.teams.forEach(t => {
        teamGroups.poolToGroup[t.id] = null;
    });
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
    renderTeamsModalContent();
}

function createNewTeamGroup() {
    const nameInput = document.getElementById('new-group-name');
    const coachInput = document.getElementById('new-group-coach');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) return alert("Veuillez saisir un nom d'équipe.");

    const id = 'GRP_CUSTOM_' + Date.now();
    teamGroups.groups.unshift({
        id: id,
        name: name,
        defaultCoach: coachInput ? coachInput.value.trim() : '',
        defaultDuration: 120
    });
    nameInput.value = '';
    if (coachInput) coachInput.value = '';

    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    renderTeamsModalContent();
}

function renameTeamGroup(groupId, newName) {
    const grp = teamGroups.groups.find(g => g.id === groupId);
    if (!grp || !newName.trim()) return;
    grp.name = newName.trim();
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
    renderTeamsModalContent();
}

function updateGroupCoach(groupId, coachName) {
    const grp = teamGroups.groups.find(g => g.id === groupId);
    if (!grp) return;
    grp.defaultCoach = coachName.trim();

    appData.matches.forEach(m => {
        if (m.groupId === groupId) {
            m.coach = grp.defaultCoach;
            customOverrides[m.id] = customOverrides[m.id] || {};
            customOverrides[m.id].coach = grp.defaultCoach;
        }
    });

    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));
}

function updateGroupDuration(groupId, durationVal) {
    const grp = teamGroups.groups.find(g => g.id === groupId);
    if (!grp) return;
    const dur = Number(durationVal) || 120;
    grp.defaultDuration = dur;

    appData.matches.forEach(m => {
        if (m.groupId === groupId) {
            m.duration = dur;
            customOverrides[m.id] = customOverrides[m.id] || {};
            customOverrides[m.id].duration = dur;
        }
    });

    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));
}

function deleteTeamGroup(groupId) {
    Object.keys(teamGroups.poolToGroup).forEach(pid => {
        if (teamGroups.poolToGroup[pid] === groupId) {
            teamGroups.poolToGroup[pid] = null;
        }
    });
    teamGroups.groups = teamGroups.groups.filter(g => g.id !== groupId);
    localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
    syncMatchesWithTeamGroups();
    renderTeamsModalContent();
}

function resetAutoTeamGroups() {
    buildOrSyncTeamGroups(true);
    renderTeamsModalContent();
}

function showImportSummaryToast(stats) {
    let existing = document.getElementById('import-summary-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'import-summary-toast';
    toast.className = 'fixed bottom-4 right-4 left-4 sm:left-auto z-50 bg-[#1e1e1e] border border-indigo-500/80 text-white p-4 rounded-xl shadow-2xl sm:max-w-md text-xs space-y-2';
    toast.innerHTML = `
        <div class="flex items-center justify-between gap-4 border-b border-neutral-800 pb-2">
            <span class="font-bold text-sm text-emerald-400 flex items-center gap-1.5">
                <i class="fa-solid fa-circle-check"></i> Mise à jour terminée
            </span>
            <button onclick="this.closest('#import-summary-toast').remove()" class="text-neutral-400 hover:text-white">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <ul class="space-y-1 text-neutral-300">
            <li>➕ <b>${stats.added || 0}</b> nouveau(x) match(s) ajouté(s)</li>
            <li>🛡️ <b>${stats.keptLocalMods || 0}</b> modification(s) locale(s) conservée(s)</li>
            ${stats.updatedFromFbi > 0 ? `<li class="text-indigo-300">🔄 <b>${stats.updatedFromFbi}</b> match(s) mis à jour depuis FBI</li>` : ''}
            ${stats.scoresUpdated > 0 ? `<li class="text-amber-300">🏀 <b>${stats.scoresUpdated}</b> score(s) enregistré(s)</li>` : ''}
        </ul>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 8000);
}

function mergeIncomingMatches(incomingMatches, incomingTeamsMap, detectedClubName, sourceLabel) {
    if (typeof applyOverrides === 'function') {
        applyOverrides();
    }

    if (!appData.matches || appData.matches.length === 0) {
        appData = {
            club: {
                id: "00000",
                code: "CLUB_FBI",
                nom: detectedClubName || "Mon Club"
            },
            teams: Array.from(incomingTeamsMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
            matches: incomingMatches
        };
        localStorage.setItem('espm_custom_data', JSON.stringify(appData));
        currentWeekStart = null;
        updateClubHeaderUI();
        initializeAppAfterLoad(sourceLabel);
        showImportSummaryToast({ added: incomingMatches.length, keptLocalMods: 0, updatedFromFbi: 0, scoresUpdated: 0 });
        return;
    }

    const existingTeamsMap = new Map((appData.teams || []).map(t => [t.id, t]));
    incomingTeamsMap.forEach((teamObj, teamId) => {
        if (!existingTeamsMap.has(teamId)) {
            existingTeamsMap.set(teamId, teamObj);
        }
    });

    const existingByNum = new Map();
    const existingBySignature = new Map();
    const existingByKey = new Map();

    (appData.matches || []).forEach(m => {
        existingByKey.set(m.id, m);
        if (m.numero) existingByNum.set(String(m.numero).trim(), m);
        const sig = `${m.teamId}__${m.opponent?.toUpperCase()}`.trim();
        existingBySignature.set(sig, m);
    });

    let diffItems = [];

    incomingMatches.forEach(inc => {
        const numKey = inc.numero ? String(inc.numero).trim() : null;
        const sigKey = `${inc.teamId}__${inc.opponent?.toUpperCase()}`.trim();

        let existing = (numKey && existingByNum.get(numKey)) || existingBySignature.get(sigKey);

        if (!existing) {
            diffItems.push({
                id: inc.id,
                match: inc,
                isNew: true,
                title: `${inc.groupName || inc.teamLabel} vs ${inc.opponent}`,
                desc: `➕ Nouveau match (N°${inc.numero})`,
                localInfo: 'Absent du planning',
                fbiInfo: `${inc.date} à ${inc.horaire} (${inc.salle})`,
                choice: 'fbi'
            });
            return;
        }

        const origDate = existing.origDate || existing.date;
        const origHoraire = existing.origHoraire || existing.horaire;
        const origSalle = existing.origSalle || existing.salle;

        const dateDiff = existing.date !== inc.date;
        const horaireDiff = existing.horaire !== inc.horaire;
        const salleDiff = existing.salle !== inc.salle;
        const scoreDiff = (!existing.joue && inc.joue) || (existing.score1 !== inc.score1 || existing.score2 !== inc.score2);

        if (dateDiff || horaireDiff || salleDiff || scoreDiff) {
            let changesList = [];
            if (dateDiff) changesList.push(`Date : ${existing.date} → ${inc.date}`);
            if (horaireDiff) changesList.push(`Heure : ${existing.horaire} → ${inc.horaire}`);
            if (salleDiff) changesList.push(`Salle : ${existing.salle} → ${inc.salle}`);
            if (scoreDiff) changesList.push(`Score : ${inc.score1 ?? '-'}-${inc.score2 ?? '-'}`);

            const userHasModified = Boolean(
                existing.derogationNeeded ||
                existing.date !== origDate ||
                existing.horaire !== origHoraire ||
                existing.salle !== origSalle
            );

            diffItems.push({
                id: existing.id,
                existingRef: existing,
                match: inc,
                isNew: false,
                title: `${existing.groupName || existing.teamLabel} (${existing.teamLabel}) vs ${existing.opponent}`,
                desc: changesList.join(' • '),
                localInfo: `${existing.date} à ${existing.horaire} — ${existing.salle}` + (userHasModified ? ' ⚠️ (Modifié localement)' : ''),
                fbiInfo: `${inc.date} à ${inc.horaire} — ${inc.salle}`,
                choice: userHasModified ? 'local' : 'fbi'
            });
        }
    });

    pendingImportPayload = {
        incomingMatches,
        incomingTeamsMap,
        detectedClubName,
        sourceLabel,
        existingTeamsMap,
        existingByNum,
        existingBySignature,
        existingByKey
    };

    openImportDiffModal(diffItems);
}

function openImportDiffModal(diffItems) {
    const tbody = document.getElementById('import-diff-tbody');
    const summaryEl = document.getElementById('import-diff-summary');
    if (!tbody || !summaryEl) return;

    summaryEl.innerHTML = `
        <div class="flex flex-col gap-0.5">
            <span>🔍 <b>${diffItems.length}</b> différence(s) ou nouveauté(s) détectée(s).</span>
            <span class="text-[11px] text-neutral-400">Arbitrez ligne par ligne ou utilisez une action groupée :</span>
        </div>
        ${diffItems.length > 0 ? `
            <div class="flex items-center gap-2 w-full sm:w-auto">
                <button type="button" onclick="setAllDiffChoices('local')" class="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 font-semibold transition text-xs">
                    Tout garder local 🛡️
                </button>
                <button type="button" onclick="setAllDiffChoices('fbi')" class="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 font-semibold transition text-xs">
                    Tout prendre FBI 🔄
                </button>
            </div>
        ` : ''}
    `;

    if (diffItems.length === 0) {
        tbody.innerHTML = `<tr class="block md:table-row"><td colspan="4" class="py-10 text-center text-emerald-400 font-semibold block md:table-cell"><i class="fa-solid fa-circle-check mr-2"></i> Votre planning local est rigoureusement identique au fichier importé !</td></tr>`;
        document.getElementById('import-diff-modal').classList.remove('hidden');
        return;
    }

    tbody.innerHTML = diffItems.map((item, idx) => `
        <tr class="flex flex-col md:table-row p-3 md:p-0 gap-2 md:gap-0 hover:bg-[#1a1a1a] transition border-b border-neutral-800/80">
            <td class="md:py-3 md:px-4 align-middle block md:table-cell">
                <div class="font-bold text-white text-xs">${item.title || 'Rencontre'}</div>
                <div class="text-[10px] text-amber-400 font-medium">${item.desc || 'Mise à jour'}</div>
            </td>
            <td class="md:py-3 md:px-4 align-middle font-mono text-neutral-300 block md:table-cell">
                <span class="md:hidden text-[10px] text-neutral-500 uppercase font-sans font-bold block">Version locale :</span>
                <div class="text-[11px]">${item.localInfo || '—'}</div>
            </td>
            <td class="md:py-3 md:px-4 align-middle font-mono text-indigo-300 block md:table-cell">
                <span class="md:hidden text-[10px] text-neutral-500 uppercase font-sans font-bold block">Version FBI :</span>
                <div class="text-[11px]">${item.fbiInfo || '—'}</div>
            </td>
            <td class="md:py-3 md:px-4 align-middle text-right whitespace-nowrap block md:table-cell">
                <div class="inline-flex w-full md:w-auto rounded-lg p-1 bg-[#121212] border border-neutral-700 text-xs">
                    <button type="button" onclick="setDiffChoice(${idx}, 'local')" id="btn-local-${idx}"
                            class="flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded font-semibold transition ${item.choice === 'local' ? 'bg-amber-600 text-white shadow' : 'text-neutral-400 hover:text-white'}">
                        Garder local 🛡️
                    </button>
                    <button type="button" onclick="setDiffChoice(${idx}, 'fbi')" id="btn-fbi-${idx}"
                            class="flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded font-semibold transition ${item.choice === 'fbi' ? 'bg-emerald-600 text-white shadow' : 'text-neutral-400 hover:text-white'}">
                        Prendre FBI 🔄
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    window._currentDiffItems = diffItems;
    document.getElementById('import-diff-modal').classList.remove('hidden');
}

function setDiffChoice(idx, choice) {
    if (window._currentDiffItems && window._currentDiffItems[idx]) {
        window._currentDiffItems[idx].choice = choice;
        const btnLocal = document.getElementById(`btn-local-${idx}`);
        const btnFbi = document.getElementById(`btn-fbi-${idx}`);
        if (btnLocal && btnFbi) {
            if (choice === 'local') {
                btnLocal.className = "flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded font-semibold transition bg-amber-600 text-white shadow";
                btnFbi.className = "flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded font-semibold transition text-neutral-400 hover:text-white";
            } else {
                btnLocal.className = "flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded font-semibold transition text-neutral-400 hover:text-white";
                btnFbi.className = "flex-1 md:flex-none px-3 py-1.5 md:py-1 rounded font-semibold transition bg-emerald-600 text-white shadow";
            }
        }
    }
}

function setAllDiffChoices(choice) {
    const items = window._currentDiffItems || [];
    items.forEach((_, idx) => setDiffChoice(idx, choice));
}

function closeImportDiffModal() {
    document.getElementById('import-diff-modal').classList.add('hidden');
    pendingImportPayload = null;
}

function applySelectedImportDiffs() {
    if (!pendingImportPayload) return;
    const { incomingMatches, incomingTeamsMap, detectedClubName, sourceLabel, existingTeamsMap, existingByNum, existingBySignature, existingByKey } = pendingImportPayload;
    const diffItems = window._currentDiffItems || [];

    const stats = { added: 0, keptLocalMods: 0, updatedFromFbi: 0, scoresUpdated: 0 };

    incomingTeamsMap.forEach((teamObj, teamId) => {
        if (!existingTeamsMap.has(teamId)) {
            existingTeamsMap.set(teamId, teamObj);
        }
    });

    diffItems.forEach(item => {
        if (item.choice === 'fbi') {
            const inc = item.match;
            const numKey = inc.numero ? String(inc.numero).trim() : null;
            const sigKey = `${inc.teamId}__${inc.opponent?.toUpperCase()}`.trim();
            const existing = item.existingRef || (numKey && existingByNum.get(numKey)) || existingBySignature.get(sigKey);

            if (item.isNew || !existing) {
                if (customOverrides[inc.id]) Object.assign(inc, customOverrides[inc.id]);
                existingByKey.set(inc.id, inc);
                stats.added++;
            } else {
                if (inc.joue) stats.scoresUpdated++;
                existing.joue = inc.joue;
                existing.score1 = inc.score1;
                existing.score2 = inc.score2;
                existing.equipe1 = inc.equipe1;
                existing.equipe2 = inc.equipe2;
                existing.opponent = inc.opponent;
                existing.isHome = inc.isHome;

                existing.date = inc.date;
                existing.horaire = inc.horaire;
                existing.salle = inc.salle;
                existing.origDate = inc.date;
                existing.origHoraire = inc.horaire;
                existing.origSalle = inc.salle;

                existing.derogationNeeded = false;
                existing.derogationDone = false;
                delete customOverrides[existing.id];
                delete customOverrides[makeMatchKey(existing.teamId, existing.numero)];

                stats.updatedFromFbi++;
            }
        } else {
            stats.keptLocalMods++;
        }
    });

    incomingMatches.forEach(inc => {
        const numKey = inc.numero ? String(inc.numero).trim() : null;
        const sigKey = `${inc.teamId}__${inc.opponent?.toUpperCase()}`.trim();
        const existing = (numKey && existingByNum.get(numKey)) || existingBySignature.get(sigKey);
        if (!existing && !diffItems.some(d => d.match === inc)) {
            existingByKey.set(inc.id, inc);
            stats.added++;
        }
    });

    appData = {
        club: {
            id: appData.club?.id || "00000",
            code: appData.club?.code || "CLUB_FBI",
            nom: detectedClubName || appData.club?.nom || "Mon Club"
        },
        teams: Array.from(existingTeamsMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
        matches: Array.from(existingByKey.values())
    };

    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));

    closeImportDiffModal();
    updateClubHeaderUI();
    initializeAppAfterLoad(sourceLabel);
    showImportSummaryToast(stats);
}

function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    if (file.name.endsWith('.json')) {
        reader.onload = function(e) {
            try {
                const json = JSON.parse(e.target.result);

                if (json.isFullBackup && json.appData) {
                    appData = json.appData;
                    customOverrides = json.customOverrides || {};
                    teamGroups = json.teamGroups || null;

                    localStorage.setItem('espm_custom_data', JSON.stringify(appData));
                    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
                    if (teamGroups) {
                        localStorage.setItem('espm_team_groups', JSON.stringify(teamGroups));
                    }

                    currentWeekStart = null;
                    updateClubHeaderUI();
                    initializeAppAfterLoad("Sauvegarde restaurée");
                    event.target.value = '';
                    return;
                }

                const incomingMatches = (json.matches || []).filter(m =>
                    !String(m.equipe1 || '').toUpperCase().includes('EXEMPT') &&
                    !String(m.equipe2 || '').toUpperCase().includes('EXEMPT') &&
                    !String(m.opponent || '').toUpperCase().includes('EXEMPT')
                );
                const incomingTeamsMap = new Map((json.teams || []).map(t => [t.id, t]));
                mergeIncomingMatches(incomingMatches, incomingTeamsMap, json.club?.nom, "Fusion JSON");
                event.target.value = '';
            } catch (err) {
                alert("Erreur de lecture JSON : " + err.message);
            }
        };
        reader.readAsText(file);
        return;
    }

    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', raw: false });
            const firstSheet = workbook.SheetNames[0];
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });

            let teamNameCounts = {};
            rows.forEach(row => {
                const eq1 = String(row['Equipe 1'] || '').trim();
                const eq2 = String(row['Equipe 2'] || '').trim();
                if (eq1 && !eq1.toUpperCase().includes('EXEMPT')) teamNameCounts[eq1] = (teamNameCounts[eq1] || 0) + 1;
                if (eq2 && !eq2.toUpperCase().includes('EXEMPT')) teamNameCounts[eq2] = (teamNameCounts[eq2] || 0) + 1;
            });

            let mostFrequentTeam = Object.keys(teamNameCounts).reduce((a, b) => teamNameCounts[a] > teamNameCounts[b] ? a : b, "");
            let clubKeyword = mostFrequentTeam.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*-\s*\d+\s*$/, '').trim();
            if (!clubKeyword && appData.club?.nom) {
                clubKeyword = appData.club.nom;
            }
            let clubParts = clubKeyword.split(' ');
            let mainClubIdentifier = clubParts.length > 1 ? clubParts.slice(1).join(' ') : clubKeyword;

            let incomingMatches = [];
            let incomingTeamsMap = new Map();

            rows.forEach((row, idx) => {
                const eq1 = String(row['Equipe 1'] || '').trim();
                const eq2 = String(row['Equipe 2'] || '').trim();

                if (!eq1 || !eq2 || eq1.toUpperCase().includes('EXEMPT') || eq2.toUpperCase().includes('EXEMPT')) {
                    return;
                }

                const matchNumCol = Object.keys(row).find(k => k.toLowerCase().includes('match'));
                const rawMatchNum = String((matchNumCol ? row[matchNumCol] : '') || `M_${idx}`).trim();

                let rawDate = String(row['Date de rencontre'] || '').trim();
                let dateStr = "2026-11-01";
                if (rawDate.includes('/')) {
                    const parts = rawDate.split('/');
                    if (parts.length === 3) {
                        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                        dateStr = `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                } else if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
                    dateStr = rawDate.slice(0, 10);
                }

                let rawTime = String(row['Heure'] || '15:00').trim().replace('h', ':').replace('H', ':');
                let horaire = (rawTime === '' || rawTime === '00:00' || rawTime === 'nan') ? '15:00' : rawTime;
                if (/^\d{4}$/.test(horaire)) {
                    horaire = horaire.slice(0, 2) + ':' + horaire.slice(2);
                } else if (/^\d{1,2}:\d{2}$/.test(horaire)) {
                    const [hh, mm] = horaire.split(':');
                    horaire = `${hh.padStart(2, '0')}:${mm}`;
                } else {
                    horaire = '15:00';
                }

                const division = String(row['Division'] || 'Championnat').trim();
                let salle = String(row['Salle'] || '').trim();

                const isHome = (mainClubIdentifier && eq1.toUpperCase().includes(mainClubIdentifier.toUpperCase())) ||
                               (clubKeyword && eq1.toUpperCase().includes(clubKeyword.toUpperCase()));

                const opponent = isHome ? eq2 : eq1;
                if (!salle || salle.toLowerCase() === 'nan') {
                    salle = isHome ? "Gymnase principal du club" : "Salle extérieure";
                }

                const teamId = slugifyId(division);
                const compositeId = makeMatchKey(teamId, rawMatchNum);

                if (!incomingTeamsMap.has(teamId)) {
                    incomingTeamsMap.set(teamId, {
                        id: teamId,
                        label: division,
                        competition: division,
                        officialTeamName: isHome ? eq1 : eq2
                    });
                }

                const s1 = parseFloat(row['Score 1']);
                const s2 = parseFloat(row['Score 2']);
                const defaultDur = /U11|U9|U7/i.test(division) ? 75 : (/^RF2$/i.test(division) ? 150 : 120);

                incomingMatches.push({
                    id: compositeId,
                    numero: rawMatchNum,
                    date: dateStr,
                    horaire: horaire,
                    duration: defaultDur,
                    origDate: dateStr,
                    origHoraire: horaire,
                    origSalle: salle,
                    teamId: teamId,
                    teamLabel: division,
                    competition: division,
                    isHome: isHome,
                    equipe1: eq1,
                    equipe2: eq2,
                    opponent: opponent,
                    salle: salle,
                    joue: !isNaN(s1) && !isNaN(s2),
                    score1: isNaN(s1) ? null : s1,
                    score2: isNaN(s2) ? null : s2,
                    derogationNeeded: false,
                    derogationDone: false
                });
            });

            mergeIncomingMatches(incomingMatches, incomingTeamsMap, clubKeyword, "Import Excel FBI");
            event.target.value = '';
        } catch (err) {
            alert("Erreur lors de l'import Excel : " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function initTeamFilter() {
    const select = document.getElementById('team-filter');
    if (!select) return;
    const currentVal = select.value;

    let html = `<option value="">Toutes les équipes (${appData.matches.length} matchs)</option>`;

    if (teamGroups && teamGroups.groups.length > 0) {
        html += `<optgroup label="🏀 Équipes du club (Poules regroupées)">`;
        teamGroups.groups.forEach(g => {
            const pools = getPoolsForGroup(g.id);
            if (pools.length === 0) return;
            const count = appData.matches.filter(m => m.groupId === g.id).length;
            const poolsHint = pools.map(p => p.label).join(' + ');
            html += `<option value="GRP:${g.id}">${g.name} (${count} m. — ${poolsHint})</option>`;
        });
        html += `</optgroup>`;
    }

    if (appData.teams.length > 0) {
        html += `<optgroup label="🏷️ Poules FBI brutes (Individuelles)">`;
        appData.teams.forEach(t => {
            const count = appData.matches.filter(m => m.teamId === t.id).length;
            html += `<option value="POOL:${t.id}">${t.label} (${count} m.)</option>`;
        });
        html += `</optgroup>`;
    }

    select.innerHTML = html;
    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    }
}

function exportICS() {
    if (!appData.matches || appData.matches.length === 0) {
        alert("Aucun match à exporter.");
        return;
    }

    const mode = document.getElementById('ics-export-mode').value;
    let matchesToExport = appData.matches;
    if (mode === 'filtered') matchesToExport = getFilteredMatches();
    if (mode === 'home') matchesToExport = appData.matches.filter(m => m.isHome);
    if (mode === 'away') matchesToExport = appData.matches.filter(m => !m.isHome);

    if (matchesToExport.length === 0) {
        alert("Aucun match correspondant à ce filtre.");
        return;
    }

    let icsLines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Club Manager//Sport Planner//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH"
    ];

    const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + "Z";

    matchesToExport.forEach(m => {
        const dateClean = m.date.replace(/-/g, '');
        const startMin = timeToMinutes(m.horaire);
        const dur = getMatchDuration(m);
        const endMin = startMin + dur;

        const startH = String(Math.floor(startMin / 60)).padStart(2, '0') + String(startMin % 60).padStart(2, '0') + "00";
        const endH = String(Math.floor(endMin / 60) % 24).padStart(2, '0') + String(endMin % 60).padStart(2, '0') + "00";

        const prefix = m.isHome ? "🏠 [DOM]" : "✈️ [EXT]";
        const teamDisplay = m.groupName ? `${m.groupName} (${m.teamLabel})` : m.teamLabel;
        const derogTag = (m.derogationNeeded && !m.derogationDone) ? " [⚠️ DÉROG À FAIRE]" : "";
        const summary = `${prefix} ${teamDisplay} vs ${m.opponent}${derogTag}`;

        let desc = `Équipe : ${teamDisplay}\\nPoule FBI : ${m.competition}\\nDurée créneau : ${formatDurationLabel(dur)}\\nLieu : ${m.isHome ? 'Domicile' : 'Extérieur'}\\nMatch N° : ${m.numero}`;
        if (m.coach) desc += `\\nCoach : ${m.coach}`;

        icsLines.push(
            "BEGIN:VEVENT",
            `UID:match_${m.id}@planner.fr`,
            `DTSTAMP:${dtStamp}`,
            `DTSTART:${dateClean}T${startH}`,
            `DTEND:${dateClean}T${endH}`,
            `SUMMARY:${summary}`,
            `LOCATION:${m.salle}`,
            `DESCRIPTION:${desc}`,
            "END:VEVENT"
        );
    });

    icsLines.push("END:VCALENDAR");

    const blob = new Blob([icsLines.join("\r\n")], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planning_club_${mode}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function exportBackupJSON() {
    if (!appData.matches || appData.matches.length === 0) {
        alert("Aucune donnée à sauvegarder.");
        return;
    }

    const backupPayload = {
        isFullBackup: true,
        exportedAt: new Date().toISOString(),
        appData: appData,
        customOverrides: customOverrides,
        teamGroups: teamGroups
    };

    const clubSlug = slugifyId(appData.club?.nom || 'club').toLowerCase();
    const dateStamp = new Date().toISOString().slice(0, 10);

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sauvegarde_planning_${clubSlug}_${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function clearAllClubData() {
    if (!confirm("Voulez-vous effacer toutes les données locales de ce navigateur (utile pour charger un autre club ou repartir à zéro) ?")) return;
    localStorage.removeItem('espm_custom_data');
    localStorage.removeItem('espm_overrides');
    localStorage.removeItem('espm_team_groups');
    appData = { club: {}, teams: [], matches: [] };
    customOverrides = {};
    teamGroups = null;
    conflictingGymMatchIds.clear();
    conflictingCoachMatchIds.clear();
    currentWeekStart = null;
    updateClubHeaderUI();
    initTeamFilter();
    detectConflictsAndDerogations();
    renderView();
    const statusEl = document.getElementById('api-status');
    if (statusEl) {
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> Aucun fichier chargé`;
    }
}