/**
 * js/app.js
 * Logique d'affichage : Vue Calendar (style Google Calendar avec colonnes décalées et Drag & Drop + tooltip live)
 * et Vue Liste repensée (tri multi-critères, regroupement par Équipe, Date, Semaine, Mois, Statut).
 */

let currentView = 'calendar'; // 'calendar' ou 'list'
let currentWeekStart = null;
let collapsedGroups = new Set();
let draggedCalendarMatchId = null;

const START_HOUR = 8;
const END_HOUR = 23;
const HOUR_HEIGHT = 60;

function toLocalISO(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseLocalISO(dateStr) {
    const [y, m, d] = (dateStr || '2026-11-01').split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function getMonday(d) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const day = copy.getDay();
    const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
    copy.setDate(diff);
    return copy;
}

function timeToMinutes(timeStr) {
    const parts = (timeStr || '15:00').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function minutesToTime(totalMin) {
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const savedData = localStorage.getItem('espm_custom_data');
    if (savedData) {
        try {
            appData = JSON.parse(savedData);
            initializeAppAfterLoad("Mémoire navigateur");
            return;
        } catch (e) {
            console.error(e);
        }
    }

    try {
        const res = await fetch('data/ffbb-matches.json');
        if (res.ok) {
            const json = await res.json();
            if (json.matches && json.matches.length > 0) {
                json.matches = json.matches.filter(m =>
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
                initializeAppAfterLoad("Fichier JSON club");
                return;
            }
        }
    } catch (e) {
        // En attente d'import
    }
    renderView();
});

function initializeAppAfterLoad(sourceLabel) {
    applyOverrides();
    buildOrSyncTeamGroups(false);
    initTeamFilter();
    initWeekSelector();
    detectConflictsAndDerogations();

    if (!currentWeekStart) {
        if (appData.matches.length > 0) {
            const todayIso = toLocalISO(new Date());
            const sortedDates = appData.matches.map(m => m.date).sort();
            const upcoming = sortedDates.find(d => d >= todayIso) || sortedDates[0];
            currentWeekStart = getMonday(parseLocalISO(upcoming));
        } else {
            currentWeekStart = getMonday(new Date());
        }
    }

    renderView();
    document.getElementById('api-status').innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> ${appData.matches.length} matchs (${sourceLabel})`;
}

function applyOverrides() {
    appData.matches.forEach(m => {
        m.origDate = m.origDate || m.date;
        m.origHoraire = m.origHoraire || m.horaire;
        m.origSalle = m.origSalle || m.salle;
        if (customOverrides[m.id]) {
            Object.assign(m, customOverrides[m.id]);
        }
    });
}

function resetOverrides() {
    if (!confirm("Voulez-vous effacer toutes vos modifications d'horaires et de dérogations ?")) return;
    customOverrides = {};
    localStorage.removeItem('espm_overrides');
    appData.matches.forEach(m => {
        m.date = m.origDate || m.date;
        m.horaire = m.origHoraire || m.horaire;
        m.salle = m.origSalle || m.salle;
        m.derogationNeeded = false;
        m.derogationDone = false;
    });
    syncMatchesWithTeamGroups();
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));
    detectConflictsAndDerogations();
    renderView();
}

function initWeekSelector() {
    const select = document.getElementById('week-jump');
    if (!select) return;
    select.innerHTML = '<option value="">Aller à la semaine...</option>';
    const weeksMap = new Map();

    appData.matches.forEach(m => {
        const monday = getMonday(parseLocalISO(m.date));
        const key = toLocalISO(monday);
        weeksMap.set(key, (weeksMap.get(key) || 0) + 1);
    });

    Array.from(weeksMap.keys()).sort().forEach(mondayIso => {
        const mon = parseLocalISO(mondayIso);
        const sun = new Date(mon);
        sun.setDate(sun.getDate() + 6);
        const label = `Lun ${mon.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} → Dim ${sun.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} (${weeksMap.get(mondayIso)} matchs)`;
        const opt = document.createElement('option');
        opt.value = mondayIso;
        opt.textContent = label;
        select.appendChild(opt);
    });
}

function jumpToWeek(mondayIso) {
    if (!mondayIso) return;
    currentWeekStart = parseLocalISO(mondayIso);
    renderView();
}

function changeWeek(direction) {
    if (!currentWeekStart) currentWeekStart = getMonday(new Date());
    currentWeekStart.setDate(currentWeekStart.getDate() + (direction * 7));
    renderView();
}

function switchView(view) {
    currentView = view;
    const btnCal = document.getElementById('btn-view-cal');
    const btnList = document.getElementById('btn-view-list');
    const calNav = document.getElementById('calendar-nav-controls');
    const listBar = document.getElementById('list-controls-bar');

    if (view === 'calendar') {
        if (btnCal) btnCal.className = "px-3.5 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white shadow-sm transition flex items-center gap-1.5";
        if (btnList) btnList.className = "px-3.5 py-1.5 text-xs font-semibold rounded text-neutral-400 hover:text-white transition flex items-center gap-1.5";
        if (calNav) calNav.classList.remove('hidden');
        if (listBar) {
            listBar.classList.add('hidden');
            listBar.classList.remove('flex');
        }
    } else {
        if (btnList) btnList.className = "px-3.5 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white shadow-sm transition flex items-center gap-1.5";
        if (btnCal) btnCal.className = "px-3.5 py-1.5 text-xs font-semibold rounded text-neutral-400 hover:text-white transition flex items-center gap-1.5";
        if (calNav) calNav.classList.add('hidden');
        if (listBar) {
            listBar.classList.remove('hidden');
            listBar.classList.add('flex');
        }
    }
    renderView();
}

function detectConflictsAndDerogations() {
    conflictingMatchIds.clear();
    const conflictsText = document.getElementById('conflicts-text');
    const conflictsContainer = document.getElementById('conflicts-container');
    let conflictMessages = [];

    const homeMatches = appData.matches.filter(m => m.isHome);
    const dateMap = {};

    homeMatches.forEach(m => {
        if (!dateMap[m.date]) dateMap[m.date] = [];
        const startM = timeToMinutes(m.horaire);
        const endM = startM + 120;
        dateMap[m.date].push({ ...m, startM, endM });
    });

    Object.keys(dateMap).sort().forEach(date => {
        const matches = dateMap[date].sort((a, b) => a.startM - b.startM);
        for (let i = 0; i < matches.length; i++) {
            for (let j = i + 1; j < matches.length; j++) {
                const m1 = matches[i];
                const m2 = matches[j];
                if (Math.max(m1.startM, m2.startM) < Math.min(m1.endM, m2.endM)) {
                    conflictingMatchIds.add(m1.id);
                    conflictingMatchIds.add(m2.id);
                    const dFr = parseLocalISO(date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                    conflictMessages.push(
                        `<div class="flex items-center justify-between bg-rose-900/40 px-2.5 py-1 rounded border border-rose-800/60">
                            <span><b>${dFr}</b> : <b>${m1.groupName || m1.teamLabel}</b> (${m1.horaire}-${minutesToTime(m1.endM)}) chevauche <b>${m2.groupName || m2.teamLabel}</b> (${m2.horaire}-${minutesToTime(m2.endM)})</span>
                            <button onclick="goToMatchWeek('${m1.date}')" class="text-[11px] underline text-rose-200 hover:text-white ml-2 shrink-0">Voir semaine</button>
                        </div>`
                    );
                }
            }
        }
    });

    if (conflictMessages.length > 0 && conflictsText && conflictsContainer) {
        conflictsText.innerHTML = conflictMessages.join('');
        conflictsContainer.classList.remove('hidden');
    } else if (conflictsContainer) {
        conflictsContainer.classList.add('hidden');
    }

    const derogationsContainer = document.getElementById('derogations-container');
    const derogationsText = document.getElementById('derogations-text');
    const derogMatches = appData.matches.filter(m => m.derogationNeeded);

    if (derogMatches.length > 0 && derogationsText && derogationsContainer) {
        derogationsText.innerHTML = derogMatches.map(m => `
            <div class="flex items-center justify-between bg-neutral-900/60 px-2.5 py-1 rounded border ${m.derogationDone ? 'border-emerald-700/60 text-emerald-300' : 'border-amber-700/60 text-amber-200'}">
                <span>
                    <b>${m.groupName || m.teamLabel}</b> vs ${m.opponent} : ${m.date} à <b>${m.horaire}</b> (initial : ${m.origDate} ${m.origHoraire})
                </span>
                <label class="flex items-center gap-1.5 font-bold cursor-pointer ml-2 shrink-0">
                    <input type="checkbox" ${m.derogationDone ? 'checked' : ''} onchange="toggleDerogation('${m.id}', this.checked)" class="rounded bg-neutral-900 border-neutral-600 text-emerald-500 w-3.5 h-3.5">
                    ${m.derogationDone ? 'Fait ✅' : 'À faire !'}
                </label>
            </div>
        `).join('');
        derogationsContainer.classList.remove('hidden');
    } else if (derogationsContainer) {
        derogationsContainer.classList.add('hidden');
    }
}

function goToMatchWeek(dateStr) {
    currentWeekStart = getMonday(parseLocalISO(dateStr));
    switchView('calendar');
}

function getFilteredMatches() {
    const search = (document.getElementById('search-input')?.value || '').toLowerCase();
    const teamFilter = document.getElementById('team-filter')?.value || '';
    const typeFilter = document.getElementById('type-filter')?.value || '';
    const periodFilter = currentView === 'list' ? (document.getElementById('list-period-filter')?.value || 'all') : 'all';

    return appData.matches.filter(m => {
        const matchSearch = `${m.groupName || ''} ${m.teamLabel} ${m.opponent} ${m.salle} ${m.coach || ''}`.toLowerCase();
        if (search && !matchSearch.includes(search)) return false;

        if (teamFilter) {
            if (teamFilter.startsWith('GRP:')) {
                const gid = teamFilter.slice(4);
                if (m.groupId !== gid) return false;
            } else if (teamFilter.startsWith('POOL:')) {
                const pid = teamFilter.slice(5);
                if (m.teamId !== pid) return false;
            } else if (m.teamId !== teamFilter) {
                return false;
            }
        }

        if (typeFilter === 'home' && !m.isHome) return false;
        if (typeFilter === 'away' && m.isHome) return false;

        if (periodFilter === 'upcoming' && m.joue) return false;
        if (periodFilter === 'played' && !m.joue) return false;
        if (periodFilter === 'issues' && !m.derogationNeeded && !conflictingMatchIds.has(m.id)) return false;

        return true;
    });
}

function layoutDayEvents(dayMatches) {
    const events = dayMatches.map(m => {
        const startM = timeToMinutes(m.horaire);
        return { ...m, startM, endM: startM + 120 };
    }).sort((a, b) => a.startM - b.startM || b.isHome - a.isHome);

    let clusters = [];
    let currentCluster = [];
    let clusterEnd = -1;

    events.forEach(ev => {
        if (currentCluster.length === 0 || ev.startM < clusterEnd) {
            currentCluster.push(ev);
            clusterEnd = Math.max(clusterEnd, ev.endM);
        } else {
            clusters.push(currentCluster);
            currentCluster = [ev];
            clusterEnd = ev.endM;
        }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    const positioned = [];
    clusters.forEach(cluster => {
        const columns = [];
        cluster.forEach(ev => {
            let placedCol = -1;
            for (let c = 0; c < columns.length; c++) {
                if (columns[c] <= ev.startM) {
                    placedCol = c;
                    columns[c] = ev.endM;
                    break;
                }
            }
            if (placedCol === -1) {
                placedCol = columns.length;
                columns.push(ev.endM);
            }
            ev.colIndex = placedCol;
        });

        const totalCols = columns.length;
        cluster.forEach(ev => {
            ev.totalCols = totalCols;
            positioned.push(ev);
        });
    });

    return positioned;
}

/**
 * Fonctions de Glisser-Déposer (Drag & Drop) avec Tooltip Live sur la grille Calendar
 */
function handleCalendarMatchDragStart(event, matchId) {
    draggedCalendarMatchId = matchId;
    event.dataTransfer.setData('text/plain', matchId);
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
        if (event.target && event.target.classList) {
            event.target.classList.add('dragging');
        }
    }, 0);
}

function handleCalendarMatchDragEnd(event) {
    draggedCalendarMatchId = null;
    if (event.target && event.target.classList) {
        event.target.classList.remove('dragging');
    }
    document.querySelectorAll('.calendar-col-active').forEach(el => el.classList.remove('calendar-col-active'));
    hideDragTooltip();
}

function handleCalendarDragOver(event, dateIso) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const col = event.currentTarget;
    if (col && !col.classList.contains('calendar-col-active')) {
        col.classList.add('calendar-col-active');
    }

    // Calcul en direct de l'heure survolée pour le tooltip
    const rect = col.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const totalMinutes = Math.max(0, Math.min((END_HOUR - START_HOUR) * 60, (offsetY / HOUR_HEIGHT) * 60));
    const h = START_HOUR + Math.floor(totalMinutes / 60);
    const m = Math.round((totalMinutes % 60) / 15) * 15;
    
    let finalH = Math.min(23, h);
    let finalM = m >= 60 ? 0 : m;
    if (m >= 60) finalH = Math.min(23, finalH + 1);

    const timeStr = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
    const dObj = parseLocalISO(dateIso);
    const dateFormatted = dObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });

    showDragTooltip(event.clientX, event.clientY, `${dateFormatted} à ${timeStr}`);
}

function handleCalendarDragLeave(event) {
    const col = event.currentTarget;
    if (col) col.classList.remove('calendar-col-active');
    hideDragTooltip();
}

function handleCalendarDrop(event, targetDateIso) {
    event.preventDefault();
    document.querySelectorAll('.calendar-col-active').forEach(el => el.classList.remove('calendar-col-active'));
    hideDragTooltip();

    const matchId = draggedCalendarMatchId || event.dataTransfer.getData('text/plain');
    if (!matchId) return;

    const m = appData.matches.find(x => x.id === matchId);
    if (!m) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const totalMinutesFromStart = Math.max(0, Math.min((END_HOUR - START_HOUR) * 60, (offsetY / HOUR_HEIGHT) * 60));
    const newStartHour = START_HOUR + Math.floor(totalMinutesFromStart / 60);
    const rawMinutes = Math.round((totalMinutesFromStart % 60) / 15) * 15;
    
    let finalHour = Math.min(23, newStartHour);
    let finalMinute = rawMinutes >= 60 ? 0 : rawMinutes;
    if (rawMinutes >= 60) finalHour = Math.min(23, finalHour + 1);

    const newHoraire = `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;

    const differsFromOriginal = (
        targetDateIso !== (m.origDate || m.date) ||
        newHoraire !== (m.origHoraire || m.horaire) ||
        m.salle !== (m.origSalle || m.salle)
    );

    m.date = targetDateIso;
    m.horaire = newHoraire;

    if (differsFromOriginal) {
        m.derogationNeeded = true;
        m.derogationDone = false;
    } else {
        m.derogationNeeded = false;
        m.derogationDone = false;
    }

    customOverrides[matchId] = {
        date: m.date,
        horaire: m.horaire,
        salle: m.salle,
        coach: m.coach,
        derogationNeeded: m.derogationNeeded,
        derogationDone: m.derogationDone
    };

    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));

    initWeekSelector();
    detectConflictsAndDerogations();
    renderView();
}

/**
 * Gestion du Tooltip flottant lors du Drag & Drop
 */
function showDragTooltip(x, y, text) {
    let tooltip = document.getElementById('drag-tooltip-live');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'drag-tooltip-live';
        tooltip.className = 'fixed z-50 bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xl pointer-events-none transition-transform duration-75 flex items-center gap-1.5 border border-indigo-400';
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = `<i class="fa-regular fa-clock"></i> Déplacer vers : <b>${text}</b>`;
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${y - 35}px`;
    tooltip.style.display = 'flex';
}

function hideDragTooltip() {
    const tooltip = document.getElementById('drag-tooltip-live');
    if (tooltip) tooltip.style.display = 'none';
}


function renderView() {
    if (currentView === 'calendar') {
        renderCalendar();
    } else {
        renderModernListView();
    }
}

/**
 * VUE 1 : CALENDAR HEBDOMADAIRE
 */
function renderCalendar() {
    const container = document.getElementById('view-container');
    if (!container) return;

    if (appData.matches.length === 0) {
        container.innerHTML = `
            <div class="py-24 text-center text-neutral-400 bg-[#1e1e1e] rounded-xl border border-neutral-800 shadow-sm">
                <i class="fa-solid fa-file-excel text-4xl mb-3 text-emerald-500"></i>
                <p class="font-semibold text-white text-base">Aucun match chargé</p>
                <p class="text-xs text-neutral-400 mt-1">Cliquez sur le bouton vert <b>« Importer FBI (.xlsx) »</b> en haut à droite.</p>
            </div>`;
        return;
    }

    if (!currentWeekStart) currentWeekStart = getMonday(new Date());

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() + i);
        days.push(d);
    }

    const startStr = days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const endStr = days[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const weekLabelEl = document.getElementById('current-week-label');
    if (weekLabelEl) weekLabelEl.textContent = `${startStr} – ${endStr}`;
    const weekJumpEl = document.getElementById('week-jump');
    if (weekJumpEl) weekJumpEl.value = toLocalISO(days[0]);

    const filtered = getFilteredMatches();
    const hours = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);
    const todayIso = toLocalISO(new Date());

    container.innerHTML = `
        <div class="bg-[#181818] rounded-xl border border-neutral-800 shadow-2xl overflow-hidden flex flex-col">
            <div class="calendar-grid bg-[#1f1f1f] border-b border-neutral-800 text-center sticky top-0 z-20">
                <div class="py-3 border-r border-neutral-800 text-[10px] font-medium text-neutral-500 flex items-end justify-center pb-2">
                    GMT+01
                </div>
                ${days.map(d => {
                    const dateIso = toLocalISO(d);
                    const isToday = dateIso === todayIso;
                    const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' }).toUpperCase();
                    const dayNum = d.getDate();
                    const countDay = filtered.filter(m => m.date === dateIso).length;

                    return `
                        <div class="py-2.5 border-r border-neutral-800 last:border-r-0 ${isToday ? 'bg-indigo-950/30' : ''}">
                            <span class="block text-[11px] font-semibold tracking-wider ${isToday ? 'text-indigo-400' : 'text-neutral-400'}">${dayName}</span>
                            <div class="mt-0.5 flex items-center justify-center gap-1.5">
                                <span class="text-xl font-normal ${isToday ? 'bg-indigo-600 text-white rounded-full w-8 h-8 inline-flex items-center justify-center font-bold' : 'text-neutral-200'}">${dayNum}</span>
                                ${countDay > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400 font-semibold">${countDay}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="relative overflow-x-auto overflow-y-auto max-h-[760px]">
                <div class="calendar-grid relative min-w-[1120px]">
                    <div class="border-r border-neutral-800 bg-[#161616] select-none">
                        ${hours.map(h => `
                            <div style="height: ${HOUR_HEIGHT}px;" class="border-b border-neutral-800/80 text-[11px] text-neutral-400 text-right pr-2.5 pt-1 font-mono">
                                ${String(h).padStart(2, '0')}:00
                            </div>
                        `).join('')}
                    </div>

                    ${days.map(d => {
                        const dateIso = toLocalISO(d);
                        const dayMatches = filtered.filter(m => m.date === dateIso);
                        const positionedMatches = layoutDayEvents(dayMatches);

                        return `
                            <div class="border-r border-neutral-800 last:border-r-0 relative bg-[#141414]"
                                 ondragover="handleCalendarDragOver(event, '${dateIso}')"
                                 ondragleave="handleCalendarDragLeave(event)"
                                 ondrop="handleCalendarDrop(event, '${dateIso}')">
                                
                                ${hours.map(() => `<div style="height: ${HOUR_HEIGHT}px;" class="border-b border-neutral-800/70 pointer-events-none"></div>`).join('')}

                                ${positionedMatches.map(m => {
                                    const topOffset = Math.max(0, ((m.startM - (START_HOUR * 60)) / 60) * HOUR_HEIGHT);
                                    const heightPx = (120 / 60) * HOUR_HEIGHT;
                                    const endH = minutesToTime(m.endM);

                                    const colW = 100 / m.totalCols;
                                    const leftPercent = m.colIndex * colW;
                                    const widthCalc = m.totalCols > 1 ? `calc(${colW}% - 4px)` : `calc(100% - 6px)`;
                                    const leftCalc = m.totalCols > 1 ? `calc(${leftPercent}% + 2px)` : `3px`;

                                    const isConflict = conflictingMatchIds.has(m.id);
                                    const cardStyle = m.isHome
                                        ? 'bg-[#b39ddb] text-slate-950 border-[#9575cd] hover:brightness-105'
                                        : 'bg-[#e06641] text-slate-950 border-[#c8502b] hover:brightness-105';
                                    const conflictRing = isConflict ? 'ring-2 ring-rose-500 border-rose-500' : '';

                                    return `
                                        <div draggable="true"
                                             ondragstart="handleCalendarMatchDragStart(event, '${m.id}')"
                                             ondragend="handleCalendarMatchDragEnd(event)"
                                             onclick="openModal('${m.id}')"
                                             style="top: ${topOffset}px; height: ${heightPx - 2}px; left: ${leftCalc}; width: ${widthCalc}; z-index: ${10 + m.colIndex};"
                                             class="absolute rounded-md p-1.5 border shadow-md cursor-grab active:cursor-grabbing transition flex flex-col justify-between overflow-hidden ${cardStyle} ${conflictRing}"
                                             title="${m.groupName || m.teamLabel} [${m.teamLabel}] vs ${m.opponent} (${m.horaire} - ${endH}) - ${m.salle} (Glissez pour déplacer)">
                                            
                                            <div class="leading-tight overflow-hidden pointer-events-none">
                                                <div class="flex items-center justify-between gap-1">
                                                    <span class="font-extrabold text-[11px] truncate">
                                                        ${m.isHome ? '🏠' : '✈️'} ${m.groupName || m.teamLabel}
                                                    </span>
                                                    ${isConflict ? `<span class="bg-rose-600 text-white text-[8px] font-bold px-1 rounded shrink-0">CONFLIT</span>` : ''}
                                                </div>
                                                <p class="font-bold text-[10px] truncate opacity-95">vs ${m.opponent}</p>
                                                <p class="text-[10px] font-semibold opacity-85 mt-0.5">De ${m.horaire} à ${endH} • <span class="underline">${m.teamLabel}</span></p>
                                                <p class="text-[9px] truncate opacity-80">${m.salle}</p>
                                            </div>

                                            ${m.derogationNeeded ? `
                                                <div onclick="event.stopPropagation()" class="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center justify-between ${m.derogationDone ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-950 text-amber-200'}">
                                                    <span class="truncate">${m.derogationDone ? 'Dérog. OK' : '⚠️ Dérog. à faire !'}</span>
                                                    <input type="checkbox" ${m.derogationDone ? 'checked' : ''} onchange="toggleDerogation('${m.id}', this.checked)" class="rounded w-3 h-3 cursor-pointer ml-1 shrink-0">
                                                </div>
                                            ` : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * VUE 2 : NOUVELLE VUE LISTE MODERNE
 */
function renderModernListView() {
    const container = document.getElementById('view-container');
    if (!container) return;

    const groupBy = document.getElementById('list-group-by')?.value || 'team';
    const sortBy = document.getElementById('list-sort-by')?.value || 'date-asc';

    let matches = getFilteredMatches();

    matches.sort((a, b) => {
        if (sortBy === 'date-asc') return a.date.localeCompare(b.date) || a.horaire.localeCompare(b.horaire);
        if (sortBy === 'date-desc') return b.date.localeCompare(a.date) || b.horaire.localeCompare(a.horaire);
        if (sortBy === 'team-asc') return (a.groupName || a.teamLabel).localeCompare(b.groupName || b.teamLabel) || a.date.localeCompare(b.date);
        if (sortBy === 'home-first') return (b.isHome - a.isHome) || a.date.localeCompare(b.date) || a.horaire.localeCompare(b.horaire);
        if (sortBy === 'salle-asc') return a.salle.localeCompare(b.salle) || a.date.localeCompare(b.date);
        return 0;
    });

    const homeCount = matches.filter(m => m.isHome).length;
    const awayCount = matches.length - homeCount;
    const summaryEl = document.getElementById('list-summary-counter');
    if (summaryEl) {
        summaryEl.innerHTML = `<span class="text-white font-bold">${matches.length}</span> rencontres (<span class="text-[#b39ddb]">🏠 ${homeCount} dom.</span> / <span class="text-[#e06641]">✈️ ${awayCount} ext.</span>)`;
    }

    if (matches.length === 0) {
        container.innerHTML = `
            <div class="py-16 text-center text-neutral-400 bg-[#1e1e1e] rounded-xl border border-neutral-800">
                Aucune rencontre ne correspond à vos critères de recherche.
            </div>`;
        return;
    }

    const groupsMap = new Map();

    matches.forEach(m => {
        let key = 'ALL';
        let title = 'Toutes les rencontres';
        let subtitle = '';

        if (groupBy === 'team') {
            key = m.groupId || m.teamId;
            title = m.groupName || m.teamLabel;
            const pools = getPoolsForGroup(key).map(p => p.label);
            subtitle = pools.length > 0 ? `Poules regroupées : ${pools.join(' • ')}` : `Poule : ${m.teamLabel}`;
        } else if (groupBy === 'date') {
            key = m.date;
            const dObj = parseLocalISO(m.date);
            title = dObj.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
            title = title.charAt(0).toUpperCase() + title.slice(1);
        } else if (groupBy === 'week') {
            const mon = getMonday(parseLocalISO(m.date));
            const sun = new Date(mon);
            sun.setDate(sun.getDate() + 6);
            key = toLocalISO(mon);
            title = `Semaine du ${mon.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} au ${sun.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
        } else if (groupBy === 'month') {
            key = m.date.slice(0, 7);
            const dObj = parseLocalISO(m.date);
            title = dObj.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
            title = title.charAt(0).toUpperCase() + title.slice(1);
        } else if (groupBy === 'status') {
            const isConflict = conflictingMatchIds.has(m.id);
            if (isConflict) {
                key = '1_CONFLICT';
                title = '🚨 Conflits de créneaux à domicile (Superposition 2h)';
            } else if (m.derogationNeeded && !m.derogationDone) {
                key = '2_DEROG_TODO';
                title = '⚠️ Dérogations à faire';
            } else if (m.derogationNeeded && m.derogationDone) {
                key = '3_DEROG_DONE';
                title = '✅ Dérogations effectuées';
            } else {
                key = '4_NORMAL';
                title = '📅 Rencontres sans alerte';
            }
        }

        if (!groupsMap.has(key)) {
            groupsMap.set(key, { key, title, subtitle, items: [] });
        }
        groupsMap.get(key).items.push(m);
    });

    let groupsArray = Array.from(groupsMap.values());
    if (groupBy === 'team') {
        groupsArray.sort((a, b) => a.title.localeCompare(b.title));
    } else if (['date', 'week', 'month', 'status'].includes(groupBy)) {
        groupsArray.sort((a, b) => sortBy === 'date-desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
    }

    container.innerHTML = `
        <div class="space-y-4">
            ${groupsArray.map(grp => {
                const isCollapsed = collapsedGroups.has(grp.key);
                const domCount = grp.items.filter(x => x.isHome).length;

                return `
                    <div class="bg-[#181818] rounded-xl border border-neutral-800 shadow-lg overflow-hidden">
                        <div onclick="toggleGroupCollapse('${grp.key}')" class="bg-[#202020] hover:bg-[#262626] px-5 py-3 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none transition">
                            <div class="flex items-center gap-3">
                                <i class="fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'} text-neutral-400 text-xs w-4"></i>
                                <div>
                                    <h3 class="font-bold text-sm text-white flex items-center gap-2">
                                        ${grp.title}
                                    </h3>
                                    ${grp.subtitle ? `<p class="text-[11px] text-amber-400/90 font-medium">${grp.subtitle}</p>` : ''}
                                </div>
                            </div>
                            <div class="flex items-center gap-2 text-xs">
                                <span class="px-2.5 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-semibold">
                                    ${grp.items.length} match(s)
                                </span>
                                <span class="px-2.5 py-0.5 rounded-full bg-[#b39ddb]/20 text-[#b39ddb] border border-[#b39ddb]/30 font-semibold">
                                    🏠 ${domCount} dom.
                                </span>
                            </div>
                        </div>

                        <div class="${isCollapsed ? 'hidden' : 'block'} overflow-x-auto">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="bg-[#141414] text-[11px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
                                        <th class="py-2.5 px-4">Date & Créneau (2h)</th>
                                        <th class="py-2.5 px-4">Lieu</th>
                                        <th class="py-2.5 px-4">Équipe & Poule FBI</th>
                                        <th class="py-2.5 px-4">Adversaire / Score</th>
                                        <th class="py-2.5 px-4">Salle & Coach</th>
                                        <th class="py-2.5 px-4">Statut / Dérogation</th>
                                        <th class="py-2.5 px-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-800/70 text-xs">
                                    ${grp.items.map(m => renderListRowHTML(m)).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderListRowHTML(m) {
    const dObj = parseLocalISO(m.date);
    const dateFormatted = dObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const endH = minutesToTime(timeToMinutes(m.horaire) + 120);
    const isConflict = conflictingMatchIds.has(m.id);

    const rowBg = isConflict
        ? 'bg-rose-950/30 hover:bg-rose-950/50'
        : 'hover:bg-[#222222]';

    return `
        <tr class="${rowBg} transition">
            <td class="py-3 px-4 whitespace-nowrap">
                <div class="font-bold text-white">${dateFormatted}</div>
                <div class="text-[11px] text-indigo-400 font-mono font-semibold">
                    <i class="fa-regular fa-clock mr-1"></i>${m.horaire} → ${endH}
                </div>
            </td>

            <td class="py-3 px-4 whitespace-nowrap">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold ${m.isHome ? 'bg-[#b39ddb] text-slate-950' : 'bg-[#e06641] text-slate-950'}">
                    ${m.isHome ? '🏠 Domicile' : '✈️ Extérieur'}
                </span>
            </td>

            <td class="py-3 px-4">
                <div class="font-bold text-white text-xs">${m.groupName || m.teamLabel}</div>
                <span class="inline-block mt-0.5 text-[10px] px-1.5 py-0.2 bg-neutral-800 text-amber-300 border border-neutral-700 rounded font-medium">
                    Poule : ${m.teamLabel}
                </span>
            </td>

            <td class="py-3 px-4">
                <div class="font-semibold text-neutral-200">vs <span class="text-white font-bold">${m.opponent}</span></div>
                ${m.joue && m.score1 !== null && m.score2 !== null ? `
                    <span class="inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-emerald-400 font-mono font-bold">
                        Score : ${m.score1} - ${m.score2}
                    </span>
                ` : `<span class="text-[10px] text-neutral-500">Match N° ${m.numero}</span>`}
            </td>

            <td class="py-3 px-4">
                <div class="text-neutral-300 flex items-center gap-1.5">
                    <i class="fa-solid fa-location-dot text-neutral-500"></i>
                    <span class="truncate max-w-[220px]" title="${m.salle}">${m.salle}</span>
                </div>
                ${m.coach ? `
                    <div class="text-[11px] text-indigo-300 font-semibold mt-0.5">
                        <i class="fa-solid fa-user-tie mr-1"></i>Coach : ${m.coach}
                    </div>
                ` : ''}
            </td>

            <td class="py-3 px-4 whitespace-nowrap">
                <div class="flex flex-col gap-1">
                    ${isConflict ? `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white w-fit">
                            <i class="fa-solid fa-triangle-exclamation"></i> Conflit 2h à domicile
                        </span>
                    ` : ''}

                    ${m.derogationNeeded ? `
                        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded border text-[11px] font-bold w-fit ${m.derogationDone ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300' : 'bg-amber-950/80 border-amber-600 text-amber-300'}">
                            <span>${m.derogationDone ? '✅ Dérog. faite' : '⚠️ Dérogation à faire !'}</span>
                            <input type="checkbox" ${m.derogationDone ? 'checked' : ''} onchange="toggleDerogation('${m.id}', this.checked)" class="rounded bg-neutral-900 border-neutral-600 text-emerald-500 w-3.5 h-3.5 cursor-pointer">
                        </div>
                    ` : (!isConflict ? `<span class="text-[11px] text-neutral-500">RAS</span>` : '')}
                </div>
            </td>

            <td class="py-3 px-4 whitespace-nowrap text-right">
                <div class="inline-flex items-center gap-1.5">
                    <button onclick="goToMatchWeek('${m.date}')" title="Voir sur la grille Calendar" class="p-1.5 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition text-xs">
                        <i class="fa-solid fa-calendar-week"></i>
                    </button>
                    <button onclick="openModal('${m.id}')" class="py-1.5 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 font-semibold transition text-xs flex items-center gap-1">
                        <i class="fa-solid fa-pen"></i> Éditer
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function toggleGroupCollapse(groupKey) {
    if (collapsedGroups.has(groupKey)) {
        collapsedGroups.delete(groupKey);
    } else {
        collapsedGroups.add(groupKey);
    }
    renderModernListView();
}

function toggleDerogation(id, isChecked) {
    const m = appData.matches.find(x => x.id === id);
    if (!m) return;
    m.derogationDone = isChecked;
    customOverrides[id] = customOverrides[id] || {};
    customOverrides[id].derogationDone = isChecked;
    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));
    detectConflictsAndDerogations();
    renderView();
}

function openModal(id) {
    const m = appData.matches.find(x => x.id === id);
    if (!m) return;

    const modalId = document.getElementById('edit-match-id');
    const modalTeam = document.getElementById('edit-team-label');
    const modalDate = document.getElementById('edit-date');
    const modalHoraire = document.getElementById('edit-horaire');
    const modalSalle = document.getElementById('edit-salle');
    const modalCoach = document.getElementById('edit-coach');
    const modalDerogDone = document.getElementById('edit-derogation-done');
    const statusSpan = document.getElementById('modal-derogation-status');

    if (modalId) modalId.value = m.id;
    if (modalTeam) modalTeam.value = `${m.isHome ? '[DOMICILE]' : '[EXTÉRIEUR]'} ${m.groupName || m.teamLabel} (Poule ${m.teamLabel}) vs ${m.opponent}`;
    if (modalDate) modalDate.value = m.date;
    if (modalHoraire) modalHoraire.value = m.horaire;
    if (modalSalle) modalSalle.value = m.salle;
    if (modalCoach) modalCoach.value = m.coach || '';
    if (modalDerogDone) modalDerogDone.checked = Boolean(m.derogationDone);

    if (statusSpan) {
        if (m.derogationNeeded) {
            statusSpan.textContent = `Horaire initial FBI : ${m.origDate} à ${m.origHoraire} (${m.origSalle})`;
        } else {
            statusSpan.textContent = "Aucun changement d'horaire/salle par rapport au fichier FBI.";
        }
    }

    const editModal = document.getElementById('edit-modal');
    if (editModal) editModal.classList.remove('hidden');
}

function closeModal() {
    const editModal = document.getElementById('edit-modal');
    if (editModal) editModal.classList.add('hidden');
}

function restoreMatchOriginal() {
    const id = document.getElementById('edit-match-id')?.value;
    const m = appData.matches.find(x => x.id === id);
    if (!m) return;

    m.date = m.origDate || m.date;
    m.horaire = m.origHoraire || m.horaire;
    m.salle = m.origSalle || m.salle;
    m.derogationNeeded = false;
    m.derogationDone = false;

    delete customOverrides[id];
    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));

    closeModal();
    initWeekSelector();
    detectConflictsAndDerogations();
    renderView();
}

function saveMatch() {
    const id = document.getElementById('edit-match-id')?.value;
    const m = appData.matches.find(x => x.id === id);
    if (!m) return;

    const newDate = document.getElementById('edit-date')?.value;
    const newHoraire = document.getElementById('edit-horaire')?.value;
    const newSalle = (document.getElementById('edit-salle')?.value || '').trim();
    const newCoach = (document.getElementById('edit-coach')?.value || '').trim();
    const derogDoneCheckbox = document.getElementById('edit-derogation-done')?.checked || false;

    const differsFromOriginal = (
        newDate !== (m.origDate || m.date) ||
        newHoraire !== (m.origHoraire || m.horaire) ||
        newSalle !== (m.origSalle || m.salle)
    );

    const justChangedSchedule = (newDate !== m.date || newHoraire !== m.horaire || newSalle !== m.salle);

    m.date = newDate;
    m.horaire = newHoraire;
    m.salle = newSalle;
    m.coach = newCoach;

    if (differsFromOriginal) {
        m.derogationNeeded = true;
        m.derogationDone = justChangedSchedule ? false : derogDoneCheckbox;
    } else {
        m.derogationNeeded = false;
        m.derogationDone = false;
    }

    customOverrides[id] = {
        date: m.date,
        horaire: m.horaire,
        salle: m.salle,
        coach: m.coach,
        derogationNeeded: m.derogationNeeded,
        derogationDone: m.derogationDone
    };

    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));

    closeModal();
    initWeekSelector();
    detectConflictsAndDerogations();
    renderView();
}