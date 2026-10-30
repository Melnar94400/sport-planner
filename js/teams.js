/**
 * js/teams.js
 * Gestion de l'état, import Excel/JSON FBI, tableau Glisser-Déposer (Drag & Drop)
 * et extraction dynamique du nom du club.
 */

let appData = { club: {}, teams: [], matches: [] };
let customOverrides = JSON.parse(localStorage.getItem('espm_overrides') || '{}');
let teamGroups = JSON.parse(localStorage.getItem('espm_team_groups') || 'null');
let conflictingMatchIds = new Set();
let draggedPoolId = null;

const DEFAULT_GROUP_RULES = [
    { id: 'GRP_SF1', name: 'Seniors Filles 1 (RF2)', match: (div) => /^RF2$/i.test(div) },
    { id: 'GRP_SF2', name: 'Seniors Filles 2 (PRF)', match: (div) => /^PRF$/i.test(div) || /^CDF/i.test(div) },
    { id: 'GRP_SM1', name: 'Seniors Garçons 1 (DM3)', match: (div) => /^DM3$/i.test(div) || /^CDM/i.test(div) },
    { id: 'GRP_SM2', name: 'Seniors Garçons 2 (DM4)', match: (div) => /^DM4$/i.test(div) },
    { id: 'GRP_U18F', name: 'U18 Féminines', match: (div) => /U18F/i.test(div) || /^RFU18/i.test(div) },
    { id: 'GRP_U18M', name: 'U18 Masculins', match: (div) => /U18M/i.test(div) },
    { id: 'GRP_U15F', name: 'U15 Féminines', match: (div) => /U15F/i.test(div) },
    { id: 'GRP_U15M', name: 'U15 Masculins', match: (div) => /U15M/i.test(div) },
    { id: 'GRP_U13F', name: 'U13 Féminines', match: (div) => /U13F/i.test(div) },
    { id: 'GRP_U13M1', name: 'U13 Masculins 1 (Élite)', match: (div) => /U13M.*ELITE/i.test(div) },
    { id: 'GRP_U13M2', name: 'U13 Masculins 2 (Initié)', match: (div) => /U13M.*BI/i.test(div) || (/U13M/i.test(div) && !/ELITE/i.test(div)) },
    { id: 'GRP_U11M', name: 'U11 Masculins', match: (div) => /U11/i.test(div) && !/DFU11|U11F/i.test(div) },
    { id: 'GRP_U11F', name: 'U11 Féminines', match: (div) => /DFU11|U11F/i.test(div) }
];

function slugifyId(str) {
    return String(str || 'EQUIPE').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
}

function updateClubHeaderUI() {
    const titleEl = document.getElementById('header-club-name');
    const subEl = document.getElementById('header-club-sub');
    if (appData.club && appData.club.nom) {
        if (titleEl) titleEl.textContent = appData.club.nom;
        if (subEl) subEl.textContent = `Gestion de planning & Dérogations (${appData.club.code || 'Club FFBB'})`;
    } else if (appData.matches && appData.matches.length > 0) {
        // Déduire le nom du club depuis l'équipe domicile la plus fréquente
        const homeMatches = appData.matches.filter(m => m.isHome);
        if (homeMatches.length > 0 && homeMatches[0].equipe1) {
            const detectedClub = homeMatches[0].equipe1.replace(/\s*\(\d+\)\s*$/, '').trim();
            if (titleEl) titleEl.textContent = detectedClub;
            if (subEl) subEl.textContent = `Gestion de planning & Dérogations (${appData.matches.length} rencontres)`;
        }
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
                existingGroupsMap.set(matchedRule.id, { id: matchedRule.id, name: matchedRule.name, defaultCoach: '' });
            }
            teamGroups.poolToGroup[poolId] = matchedRule.id;
        } else {
            const fallbackId = 'GRP_' + poolId;
            if (!existingGroupsMap.has(fallbackId)) {
                existingGroupsMap.set(fallbackId, { id: fallbackId, name: divLabel, defaultCoach: '' });
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
        } else {
            m.groupId = 'UNASSIGNED_' + m.teamId;
            m.groupName = m.teamLabel;
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

function renderPoolChipHTML(pool, isAssigned) {
    const count = appData.matches.filter(m => m.teamId === pool.id).length;
    return `
        <div draggable="true"
             ondragstart="handlePoolDragStart(event, '${pool.id}')"
             ondragend="handlePoolDragEnd(event)"
             class="pool-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shadow-sm ${
                 isAssigned
                     ? 'bg-indigo-950/90 text-indigo-200 border-indigo-700/80 hover:border-indigo-500'
                     : 'bg-amber-950/90 text-amber-200 border-amber-700/80 hover:border-amber-500'
             }">
            <i class="fa-solid fa-grip-vertical text-[10px] opacity-60"></i>
            <span>${pool.label}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-neutral-300 font-mono">${count}m</span>
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
        tableBody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-neutral-500">Aucune donnée chargée.</td></tr>`;
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
            <tr>
                <td colspan="5" class="py-10 text-center text-neutral-400">
                    Aucune équipe créée. Utilisez le champ ci-dessus pour créer votre première équipe ou cliquez sur <b>« Regroupement auto »</b>.
                </td>
            </tr>`;
        return;
    }

    tableBody.innerHTML = teamGroups.groups.map(grp => {
        const attachedPools = getPoolsForGroup(grp.id);
        const groupMatches = appData.matches.filter(m => attachedPools.some(p => p.id === m.teamId));
        const homeCount = groupMatches.filter(m => m.isHome).length;

        return `
            <tr class="hover:bg-[#1a1a1a] transition">
                <td class="py-3 px-4 align-middle">
                    <input type="text" value="${grp.name}"
                           onchange="renameTeamGroup('${grp.id}', this.value)"
                           class="w-full bg-[#1e1e1e] border border-neutral-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white focus:outline-none">
                </td>
                <td class="py-3 px-4 align-middle">
                    <input type="text" value="${grp.defaultCoach || ''}"
                           placeholder="Ajouter un coach..."
                           onchange="updateGroupCoach('${grp.id}', this.value)"
                           class="w-full bg-[#1e1e1e] border border-neutral-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none">
                </td>
                <td class="py-2.5 px-4 align-middle"
                    ondragover="handlePoolDragOver(event)"
                    ondragleave="handlePoolDragLeave(event)"
                    ondrop="handlePoolDrop(event, '${grp.id}')">
                    <div class="dropzone-area min-h-[44px] p-2 rounded-xl border-2 border-dashed border-neutral-700/80 bg-[#121212]/60 flex flex-wrap items-center gap-2">
                        ${attachedPools.length > 0
                            ? attachedPools.map(p => renderPoolChipHTML(p, true)).join('')
                            : `<span class="text-[11px] text-neutral-500 italic pointer-events-none select-none"><i class="fa-solid fa-arrow-down-long mr-1"></i>Glissez une ou plusieurs poules ici...</span>`
                        }
                    </div>
                </td>
                <td class="py-3 px-4 align-middle text-center whitespace-nowrap">
                    <div class="font-bold text-white text-xs">${groupMatches.length} match(s)</div>
                    <div class="text-[10px] text-neutral-400">🏠 ${homeCount} dom. / ✈️ ${groupMatches.length - homeCount} ext.</div>
                </td>
                <td class="py-3 px-4 align-middle text-right">
                    <button onclick="deleteTeamGroup('${grp.id}')" title="Supprimer cette équipe"
                            class="p-2 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-950/40 transition">
                        <i class="fa-solid fa-trash-can"></i>
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
        defaultCoach: coachInput ? coachInput.value.trim() : ''
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

function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    if (file.name.endsWith('.json')) {
        reader.onload = function(e) {
            try {
                const json = JSON.parse(e.target.result);
                json.matches = (json.matches || []).filter(m =>
                    !String(m.equipe1 || '').toUpperCase().includes('EXEMPT') &&
                    !String(m.equipe2 || '').toUpperCase().includes('EXEMPT') &&
                    !String(m.opponent || '').toUpperCase().includes('EXEMPT')
                );
                json.matches.forEach(m => {
                    m.origDate = m.origDate || m.date;
                    m.origHoraire = m.origHoraire || m.horaire;
                    m.origSalle = m.origSalle || m.salle;
                });
                appData = json;
                localStorage.setItem('espm_custom_data', JSON.stringify(appData));
                currentWeekStart = null;
                updateClubHeaderUI();
                initializeAppAfterLoad("Import JSON");
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

            // 1. Détection automatique du nom du club à partir des équipes les plus fréquentes
            let teamNameCounts = {};
            rows.forEach(row => {
                const eq1 = String(row['Equipe 1'] || '').trim();
                const eq2 = String(row['Equipe 2'] || '').trim();
                if (eq1 && !eq1.toUpperCase().includes('EXEMPT')) teamNameCounts[eq1] = (teamNameCounts[eq1] || 0) + 1;
                if (eq2 && !eq2.toUpperCase().includes('EXEMPT')) teamNameCounts[eq2] = (teamNameCounts[eq2] || 0) + 1;
            });

            // Trouver un fragment commun ou le nom de club le plus fréquent (ex: "ES PENNES MIRABEAU")
            let mostFrequentTeam = Object.keys(teamNameCounts).reduce((a, b) => teamNameCounts[a] > teamNameCounts[b] ? a : b, "");
            // Nettoyer le nom pour garder le nom du club sans le numéro d'équipe (ex: "ES PENNES MIRABEAU (3)" -> "PENNES MIRABEAU")
            let clubKeyword = mostFrequentTeam.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*-\s*\d+\s*$/, '').trim();
            // Si le nom est trop court, on prend un mot-clé significatif
            let clubParts = clubKeyword.split(' ');
            let mainClubIdentifier = clubParts.length > 1 ? clubParts.slice(1).join(' ') : clubKeyword;

            let matches = [];
            let teamsMap = new Map();

            rows.forEach((row, idx) => {
                const eq1 = String(row['Equipe 1'] || '').trim();
                const eq2 = String(row['Equipe 2'] || '').trim();

                if (!eq1 || !eq2 || eq1.toUpperCase().includes('EXEMPT') || eq2.toUpperCase().includes('EXEMPT')) {
                    return;
                }

                const matchId = String(row['N° de match '] || row['N° de match'] || `M_${idx}`).trim();

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

                // DÉTECTION DOMICILE / EXTÉRIEUR UNIVERSELLE :
                // Si l'équipe du club est dans Équipe 1 => Domicile, sinon Extérieur
                const isHome = eq1.toUpperCase().includes(mainClubIdentifier.toUpperCase()) || eq1.toUpperCase().includes(clubKeyword.toUpperCase());
                
                const opponent = isHome ? eq2 : eq1;
                if (!salle || salle.toLowerCase() === 'nan') {
                    salle = isHome ? "Gymnase principal du club" : "Salle extérieure";
                }

                const teamId = slugifyId(division);

                if (!teamsMap.has(teamId)) {
                    teamsMap.set(teamId, {
                        id: teamId,
                        label: division,
                        competition: division,
                        officialTeamName: isHome ? eq1 : eq2
                    });
                }

                const s1 = parseFloat(row['Score 1']);
                const s2 = parseFloat(row['Score 2']);

                matches.push({
                    id: matchId,
                    numero: matchId,
                    date: dateStr,
                    horaire: horaire,
                    origDate: dateStr,
                    origHoraire: horaire,
                    origSalle: salle,
                    teamId: teamId,
                    teamLabel: division,
                    competition: division,
                    isHome: isHome, // Vrai si le club joue en équipe 1 (domicile)
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

            appData = {
                club: { id: "00000", code: "CLUB_FBI", nom: clubKeyword || "Mon Club" },
                teams: Array.from(teamsMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
                matches: matches
            };

            localStorage.setItem('espm_custom_data', JSON.stringify(appData));
            currentWeekStart = null;
            updateClubHeaderUI();
            initializeAppAfterLoad("Import Excel FBI");
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
        const endMin = startMin + 120;

        const startH = String(Math.floor(startMin / 60)).padStart(2, '0') + String(startMin % 60).padStart(2, '0') + "00";
        const endH = String(Math.floor(endMin / 60) % 24).padStart(2, '0') + String(endMin % 60).padStart(2, '0') + "00";

        const prefix = m.isHome ? "🏠 [DOM]" : "✈️ [EXT]";
        const teamDisplay = m.groupName ? `${m.groupName} (${m.teamLabel})` : m.teamLabel;
        const derogTag = m.derogationNeeded ? (m.derogationDone ? " [Dérog OK]" : " [⚠️ DÉROG À FAIRE]") : "";
        const summary = `${prefix} ${teamDisplay} vs ${m.opponent}${derogTag}`;

        let desc = `Équipe : ${teamDisplay}\\nPoule FBI : ${m.competition}\\nLieu : ${m.isHome ? 'Domicile' : 'Extérieur'}\\nMatch N° : ${m.numero}`;
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