/**
 * js/app.js
 * Logique d'affichage responsive Mobile & Desktop :
 * - Vue Calendar (Modes 1J mobile avec onglets de jours, 3J Week-end Ven-Dim, 7J Semaine)
 * - Affichage des créneaux d'entraînement hebdomadaires (excluant automatiquement vacances scolaires & jours fériés)
 * - Vue Liste (Cartes empilées sur mobile, Tableau complet sur ordinateur, groupement par Équipe ou par Coach)
 * - Détection séparée : Fermetures de gymnases (Mairie), Conflits par Gymnase, Conflits d'Entraîneurs / Assistants
 *   (analyse individuelle de chaque coach/assistant sur plusieurs équipes, matchs et entraînements)
 * - Glisser-déposer avec Bloc Fantôme (Ghost Block) et infobulle temps réel
 */

let currentView = 'calendar';
let calendarDaysMode = localStorage.getItem('espm_cal_mode') || (window.innerWidth < 768 ? '1d' : '7d');
let showTrainingsOnCalendar = localStorage.getItem('espm_show_trainings') !== 'false';
let selectedDayIndex = 5;
let currentWeekStart = null;
let collapsedGroups = new Set();
let draggedCalendarMatchId = null;

// Map matchId -> Array of conflicting coach names for that specific match
let matchConflictingCoachNames = new Map();

const START_HOUR = 8;
const END_HOUR = 23;
const HOUR_HEIGHT = 60;
const COACH_TRAVEL_BUFFER_MIN = 30;

function toggleMobileMenu() {
    const drawer = document.getElementById('header-actions-drawer');
    const icon = document.getElementById('mobile-menu-icon');
    if (!drawer) return;
    const isHidden = drawer.classList.contains('hidden');
    if (isHidden) {
        drawer.classList.remove('hidden');
        drawer.classList.add('flex');
        if (icon) icon.className = 'fa-solid fa-xmark';
    } else {
        drawer.classList.add('hidden');
        drawer.classList.remove('flex');
        if (icon) icon.className = 'fa-solid fa-bars';
    }
}

function toggleShowTrainings() {
    showTrainingsOnCalendar = !showTrainingsOnCalendar;
    localStorage.setItem('espm_show_trainings', String(showTrainingsOnCalendar));
    updateShowTrainingsButtonUI();
    renderView();
}

function updateShowTrainingsButtonUI() {
    const btn = document.getElementById('btn-toggle-trainings');
    if (!btn) return;
    if (showTrainingsOnCalendar) {
        btn.className = "px-2.5 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 bg-teal-950/80 border-teal-600 text-teal-200";
        btn.innerHTML = `<i class="fa-solid fa-stopwatch"></i> <span>Entraînements : ON</span>`;
    } else {
        btn.className = "px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition flex items-center gap-1.5 bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white";
        btn.innerHTML = `<i class="fa-solid fa-stopwatch"></i> <span>Entraînements : OFF</span>`;
    }
}

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

function normalizeGymName(salle) {
    return String(salle || 'Gymnase principal du club').trim().toUpperCase().replace(/\s+/g, ' ');
}

function getClosuresForDate(dateIso) {
    return (gymClosures || []).filter(c => dateIso >= c.startDate && dateIso <= c.endDate);
}

document.addEventListener('DOMContentLoaded', () => {
    updateCalendarModePillsUI();
    updateShowTrainingsButtonUI();
    updateClubHeaderUI();
    initCoachFilter();
    const savedData = localStorage.getItem('espm_custom_data');
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            if (parsed && Array.isArray(parsed.matches) && parsed.matches.length > 0) {
                appData = parsed;
                updateClubHeaderUI();
                initializeAppAfterLoad("Mémoire locale");
                return;
            }
        } catch (e) {
            console.error(e);
        }
    }
    if (trainingSlots && trainingSlots.length > 0) {
        currentWeekStart = getMonday(new Date());
    }
    renderView();
});

function autoSelectActiveDayInWeek() {
    if (!currentWeekStart || !appData.matches || appData.matches.length === 0) return;
    const weekDaysIso = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() + i);
        weekDaysIso.push(toLocalISO(d));
    }
    if (appData.matches.some(m => m.date === weekDaysIso[selectedDayIndex])) return;
    if (appData.matches.some(m => m.date === weekDaysIso[5])) {
        selectedDayIndex = 5;
    } else if (appData.matches.some(m => m.date === weekDaysIso[6])) {
        selectedDayIndex = 6;
    } else {
        const firstActiveIdx = weekDaysIso.findIndex(iso => appData.matches.some(m => m.date === iso));
        if (firstActiveIdx !== -1) selectedDayIndex = firstActiveIdx;
    }
}

function initializeAppAfterLoad(sourceLabel) {
    applyOverrides();
    buildOrSyncTeamGroups(false);
    ensureKnownGymsDatalist();
    initTeamFilter();
    initCoachFilter();
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

    autoSelectActiveDayInWeek();
    renderView();
    const statusEl = document.getElementById('api-status');
    if (statusEl) {
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> ${appData.matches.length} matchs (${sourceLabel})`;
    }
}

function applyOverrides() {
    appData.matches.forEach(m => {
        m.origDate = m.origDate || m.date;
        m.origHoraire = m.origHoraire || m.horaire;
        m.origSalle = m.origSalle || m.salle;
        m.duration = Number(m.duration) || 120;

        const compositeKey = typeof makeMatchKey === 'function' ? makeMatchKey(m.teamId, m.numero || m.id) : m.id;
        const ov = customOverrides[m.id] || customOverrides[compositeKey] || customOverrides[m.numero];
        if (ov) {
            Object.assign(m, ov);
        }
    });
}

function resetOverrides() {
    if (!confirm("Voulez-vous rétablir tous les horaires FBI d'origine (annuler vos décalages de matchs) ?")) return;
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

function setCalendarDaysMode(mode) {
    calendarDaysMode = mode;
    localStorage.setItem('espm_cal_mode', calendarDaysMode);
    if (mode === '1d') autoSelectActiveDayInWeek();
    updateCalendarModePillsUI();
    renderView();
}

function selectMobileDay(dayIdx) {
    selectedDayIndex = dayIdx;
    renderView();
}

function updateCalendarModePillsUI() {
    ['1d', '3d', '7d'].forEach(m => {
        const btn = document.getElementById(`btn-mode-${m}`);
        if (!btn) return;
        if (calendarDaysMode === m) {
            btn.className = "px-2.5 py-1 rounded font-bold transition bg-indigo-600 text-white shadow-sm";
        } else {
            btn.className = "px-2.5 py-1 rounded font-semibold transition text-neutral-400 hover:text-white";
        }
    });
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
        const label = `Lun ${mon.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} → Dim ${sun.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} (${weeksMap.get(mondayIso)} m.)`;
        const opt = document.createElement('option');
        opt.value = mondayIso;
        opt.textContent = label;
        select.appendChild(opt);
    });
}

function jumpToWeek(mondayIso) {
    if (!mondayIso) return;
    currentWeekStart = parseLocalISO(mondayIso);
    autoSelectActiveDayInWeek();
    renderView();
}

function changeWeek(direction) {
    if (!currentWeekStart) currentWeekStart = getMonday(new Date());
    currentWeekStart.setDate(currentWeekStart.getDate() + (direction * 7));
    autoSelectActiveDayInWeek();
    renderView();
}

function switchView(view) {
    currentView = view;
    const btnCal = document.getElementById('btn-view-cal');
    const btnList = document.getElementById('btn-view-list');
    const calNav = document.getElementById('calendar-nav-controls');
    const calModes = document.getElementById('calendar-mode-pills');
    const trnBtn = document.getElementById('btn-toggle-trainings');
    const dayPills = document.getElementById('mobile-day-pills');
    const listBar = document.getElementById('list-controls-bar');

    if (view === 'calendar') {
        if (btnCal) btnCal.className = "px-3 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white shadow-sm transition flex items-center gap-1.5";
        if (btnList) btnList.className = "px-3 py-1.5 text-xs font-semibold rounded text-neutral-400 hover:text-white transition flex items-center gap-1.5";
        if (calNav) calNav.classList.remove('hidden');
        if (calModes) calModes.classList.remove('hidden');
        if (trnBtn) trnBtn.classList.remove('hidden');
        if (listBar) {
            listBar.classList.add('hidden');
            listBar.classList.remove('flex');
        }
    } else {
        if (btnList) btnList.className = "px-3 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white shadow-sm transition flex items-center gap-1.5";
        if (btnCal) btnCal.className = "px-3 py-1.5 text-xs font-semibold rounded text-neutral-400 hover:text-white transition flex items-center gap-1.5";
        if (calNav) calNav.classList.add('hidden');
        if (calModes) calModes.classList.add('hidden');
        if (trnBtn) trnBtn.classList.add('hidden');
        if (dayPills) {
            dayPills.classList.add('hidden');
            dayPills.classList.remove('grid');
        }
        if (listBar) {
            listBar.classList.remove('hidden');
            listBar.classList.add('flex');
        }
    }
    renderView();
}

/**
 * Détection complète :
 * 1. Fermetures de gymnases (Arrêtés municipaux / Travaux)
 * 2. Conflits par Gymnase à domicile (superposition dans la même salle)
 * 3. Conflits individuels d'Entraîneurs / Assistants (chaque coach d'une liste est vérifié sur toutes ses équipes,
 *    aussi bien entre 2 matchs qu'entre un match et un créneau d'entraînement actif)
 * 4. Dérogations FBI en attente
 */
function detectConflictsAndDerogations() {
    conflictingGymMatchIds.clear();
    conflictingCoachMatchIds.clear();
    closureConflictMatchIds.clear();
    matchConflictingCoachNames.clear();

    const closuresAlertText = document.getElementById('closures-alert-text');
    const closuresAlertContainer = document.getElementById('closures-alert-container');
    let closureMessages = [];

    // 1. FERMETURES DE GYMNASES (MAIRIE)
    appData.matches.forEach(m => {
        if (!m.isHome) return;
        const matchGym = normalizeGymName(m.salle);
        const matchDate = m.date;

        (gymClosures || []).forEach(c => {
            const closureGym = normalizeGymName(c.gymName);
            const gymMatches = !closureGym || closureGym === 'TOUS' || matchGym.includes(closureGym) || closureGym.includes(matchGym);
            if (gymMatches && matchDate >= c.startDate && matchDate <= c.endDate) {
                closureConflictMatchIds.add(m.id);
                const dFr = parseLocalISO(m.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                closureMessages.push(
                    `<div class="flex items-center justify-between bg-rose-900/60 px-2.5 py-1.5 rounded border border-rose-500/80 text-rose-100">
                        <span>🚫 <b>${dFr} (${m.horaire})</b> : <b>${m.groupName || m.teamLabel}</b> vs ${m.opponent} prévu dans <b>${m.salle}</b> alors qu'il est fermé (<em>${c.reason}</em>) !</span>
                        <div class="flex items-center gap-2 ml-2 shrink-0">
                            <button onclick="goToMatchWeek('${m.date}')" class="text-[11px] underline text-rose-200 hover:text-white">Semaine</button>
                            <button onclick="openModal('${m.id}')" class="text-[11px] px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold">Déplacer</button>
                        </div>
                    </div>`
                );
            }
        });
    });

    if (closureMessages.length > 0 && closuresAlertText && closuresAlertContainer) {
        closuresAlertText.innerHTML = closureMessages.join('');
        closuresAlertContainer.classList.remove('hidden');
    } else if (closuresAlertContainer) {
        closuresAlertContainer.classList.add('hidden');
    }

    // 2. CONFLITS PAR GYMNASE À DOMICILE
    const conflictsText = document.getElementById('conflicts-text');
    const conflictsContainer = document.getElementById('conflicts-container');
    let conflictMessages = [];

    const homeMatches = appData.matches.filter(m => m.isHome);
    const gymDateMap = {};

    homeMatches.forEach(m => {
        const gymKey = normalizeGymName(m.salle);
        const key = `${m.date}__${gymKey}`;
        if (!gymDateMap[key]) gymDateMap[key] = [];
        const startM = timeToMinutes(m.horaire);
        const dur = getMatchDuration(m);
        gymDateMap[key].push({ ...m, startM, endM: startM + dur });
    });

    Object.keys(gymDateMap).sort().forEach(key => {
        const matches = gymDateMap[key].sort((a, b) => a.startM - b.startM);
        for (let i = 0; i < matches.length; i++) {
            for (let j = i + 1; j < matches.length; j++) {
                const m1 = matches[i];
                const m2 = matches[j];
                if (Math.max(m1.startM, m2.startM) < Math.min(m1.endM, m2.endM)) {
                    conflictingGymMatchIds.add(m1.id);
                    conflictingGymMatchIds.add(m2.id);
                    const dFr = parseLocalISO(m1.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                    conflictMessages.push(
                        `<div class="flex items-center justify-between bg-rose-900/40 px-2.5 py-1.5 rounded border border-rose-800/60">
                            <span>🏟️ <b>Salle [${m1.salle}] (${dFr})</b> : <b>${m1.groupName || m1.teamLabel}</b> (${m1.horaire}-${minutesToTime(m1.endM)}) chevauche <b>${m2.groupName || m2.teamLabel}</b> (${m2.horaire}-${minutesToTime(m2.endM)})</span>
                            <button onclick="goToMatchWeek('${m1.date}')" class="text-[11px] underline text-rose-200 hover:text-white ml-2 shrink-0">Voir</button>
                        </div>`
                    );
                }
            }
        }
    });

    // 3. CONFLITS D'ENTRAÎNEURS & ASSISTANTS (MULTI-COACHS PAR ÉQUIPE & COACH MULTI-ÉQUIPES)
    const coachDateMap = {};
    const matchDatesSet = new Set();

    appData.matches.forEach(m => {
        matchDatesSet.add(m.date);
        const coaches = parseCoachList(m.coach);
        if (coaches.length === 0) return;

        const startM = timeToMinutes(m.horaire);
        const dur = getMatchDuration(m);

        coaches.forEach(cObj => {
            const key = `${m.date}__${cObj.norm}`;
            if (!coachDateMap[key]) coachDateMap[key] = [];
            coachDateMap[key].push({
                ...m,
                startM,
                endM: startM + dur,
                individualCoachName: cObj.displayName,
                individualCoachRole: cObj.role
            });
        });
    });

    // Ajouter les créneaux d'entraînement actifs les jours où il y a des matchs pour détecter les conflits Match <-> Entraînement d'un coach
    matchDatesSet.forEach(dateIso => {
        const dayTrainings = getTrainingInstancesForDate(dateIso, true);
        dayTrainings.forEach(trn => {
            const coaches = parseCoachList(trn.coach);
            if (coaches.length === 0) return;
            const startM = timeToMinutes(trn.horaire);
            const dur = getMatchDuration(trn);

            coaches.forEach(cObj => {
                const key = `${dateIso}__${cObj.norm}`;
                if (!coachDateMap[key]) coachDateMap[key] = [];
                coachDateMap[key].push({
                    ...trn,
                    startM,
                    endM: startM + dur,
                    individualCoachName: cObj.displayName,
                    individualCoachRole: cObj.role
                });
            });
        });
    });

    const markCoachConflictOnEvent = (evId, coachDisplay) => {
        conflictingCoachMatchIds.add(evId);
        if (!matchConflictingCoachNames.has(evId)) {
            matchConflictingCoachNames.set(evId, []);
        }
        const arr = matchConflictingCoachNames.get(evId);
        if (!arr.includes(coachDisplay)) arr.push(coachDisplay);
    };

    Object.keys(coachDateMap).sort().forEach(key => {
        const events = coachDateMap[key].sort((a, b) => a.startM - b.startM);
        for (let i = 0; i < events.length; i++) {
            for (let j = i + 1; j < events.length; j++) {
                const e1 = events[i];
                const e2 = events[j];

                // Si ce sont 2 créneaux d'entraînement dans la même salle (ex: 2 équipes qui s'entraînent ensemble), pas de conflit
                if (e1.isTraining && e2.isTraining && normalizeGymName(e1.salle) === normalizeGymName(e2.salle)) {
                    continue;
                }

                const sameVenue = (e1.isHome === e2.isHome) && (normalizeGymName(e1.salle) === normalizeGymName(e2.salle));
                const buffer = sameVenue ? 0 : COACH_TRAVEL_BUFFER_MIN;

                if (Math.max(e1.startM, e2.startM) < Math.min(e1.endM, e2.endM) + buffer) {
                    const coachName = e1.individualCoachName;
                    markCoachConflictOnEvent(e1.id, coachName);
                    markCoachConflictOnEvent(e2.id, coachName);

                    const dFr = parseLocalISO(e1.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                    const directOverlap = Math.max(e1.startM, e2.startM) < Math.min(e1.endM, e2.endM);
                    const reason = directOverlap ? 'simultanés' : `trajet < ${COACH_TRAVEL_BUFFER_MIN}m entre 2 salles`;

                    const label1 = e1.isTraining ? `Entraîn. ${e1.groupName}` : `${e1.groupName || e1.teamLabel}${e1.individualCoachRole ? ` (${e1.individualCoachRole})` : ''}`;
                    const label2 = e2.isTraining ? `Entraîn. ${e2.groupName}` : `${e2.groupName || e2.teamLabel}${e2.individualCoachRole ? ` (${e2.individualCoachRole})` : ''}`;

                    conflictMessages.push(
                        `<div class="flex items-center justify-between bg-purple-950/60 px-2.5 py-1.5 rounded border border-purple-700/70 text-purple-200">
                            <span>👟 <b>${coachName} (${dFr} — ${reason})</b> : <b>${label1}</b> (${e1.horaire}-${minutesToTime(e1.endM)}) & <b>${label2}</b> (${e2.horaire}-${minutesToTime(e2.endM)})</span>
                            <button onclick="goToMatchWeek('${e1.date}')" class="text-[11px] underline text-purple-200 hover:text-white ml-2 shrink-0">Voir</button>
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

    // 4. DÉROGATIONS EN ATTENTE (uniquement pour les matchs officiels FBI)
    const derogationsContainer = document.getElementById('derogations-container');
    const derogationsText = document.getElementById('derogations-text');
    const pendingDerogMatches = appData.matches.filter(m => !m.isManual && m.derogationNeeded && !m.derogationDone);

    if (pendingDerogMatches.length > 0 && derogationsText && derogationsContainer) {
        derogationsText.innerHTML = pendingDerogMatches.map(m => `
            <div class="flex items-center justify-between bg-neutral-900/60 px-2.5 py-1.5 rounded border border-amber-700/60 text-amber-200">
                <span>
                    <b>${m.groupName || m.teamLabel}</b> (${m.teamLabel} • N°${m.numero}) vs ${m.opponent} : déplacé au <b>${m.date} à ${m.horaire}</b> (initial : ${m.origDate} ${m.origHoraire})
                </span>
                <label class="flex items-center gap-1.5 font-bold cursor-pointer ml-2 shrink-0 text-amber-300 hover:text-emerald-300">
                    <input type="checkbox" onchange="toggleDerogation('${m.id}', this.checked)" class="rounded bg-neutral-900 border-neutral-600 text-emerald-500 w-3.5 h-3.5">
                    Fait
                </label>
            </div>
        `).join('');
        derogationsContainer.classList.remove('hidden');
    } else if (derogationsContainer) {
        derogationsContainer.classList.add('hidden');
    }
}

function goToMatchWeek(dateStr) {
    const targetDate = parseLocalISO(dateStr);
    currentWeekStart = getMonday(targetDate);
    const dayOfWeek = targetDate.getDay();
    selectedDayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    switchView('calendar');
}

function getFilteredMatches() {
    const search = (document.getElementById('search-input')?.value || '').toLowerCase();
    const teamFilter = document.getElementById('team-filter')?.value || '';
    const coachFilter = document.getElementById('coach-filter')?.value || '';
    const typeFilter = document.getElementById('type-filter')?.value || '';
    const periodFilter = currentView === 'list' ? (document.getElementById('list-period-filter')?.value || 'all') : 'all';

    return appData.matches.filter(m => {
        const matchSearch = `${m.groupName || ''} ${m.teamLabel} ${m.opponent} ${m.salle} ${m.coach || ''} ${m.numero || ''}`.toLowerCase();
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

        if (coachFilter && !eventHasCoach(m.coach, coachFilter)) {
            return false;
        }

        if (typeFilter === 'home' && !m.isHome) return false;
        if (typeFilter === 'away' && m.isHome) return false;

        if (periodFilter === 'upcoming' && m.joue) return false;
        if (periodFilter === 'played' && !m.joue) return false;
        if (periodFilter === 'issues' &&
            !(!m.isManual && m.derogationNeeded && !m.derogationDone) &&
            !conflictingGymMatchIds.has(m.id) &&
            !conflictingCoachMatchIds.has(m.id) &&
            !closureConflictMatchIds.has(m.id)
        ) {
            return false;
        }

        return true;
    });
}

function layoutDayEvents(dayMatches) {
    const events = dayMatches.map(m => {
        const startM = timeToMinutes(m.horaire);
        const dur = getMatchDuration(m);
        return { ...m, startM, endM: startM + dur };
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
    removeGhostBlocks();
    hideDragTooltip();
}

function removeGhostBlocks() {
    document.querySelectorAll('.calendar-ghost-block').forEach(el => el.remove());
}

function handleCalendarDragOver(event, dateIso) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const col = event.currentTarget;
    if (col && !col.classList.contains('calendar-col-active')) {
        col.classList.add('calendar-col-active');
    }

    const rect = col.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const totalMinutes = Math.max(0, Math.min((END_HOUR - START_HOUR) * 60, (offsetY / HOUR_HEIGHT) * 60));
    const h = START_HOUR + Math.floor(totalMinutes / 60);
    const m = Math.round((totalMinutes % 60) / 15) * 15;

    let finalH = Math.min(23, h);
    let finalM = m >= 60 ? 0 : m;
    if (m >= 60) finalH = Math.min(23, finalH + 1);

    const draggedMatch = appData.matches.find(x => x.id === draggedCalendarMatchId);
    const durationMin = draggedMatch ? getMatchDuration(draggedMatch) : 120;
    const startTotalMin = finalH * 60 + finalM;
    const endTotalMin = startTotalMin + durationMin;

    const timeStr = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
    const endStr = minutesToTime(endTotalMin);

    let ghost = col.querySelector('.calendar-ghost-block');
    if (!ghost) {
        removeGhostBlocks();
        ghost = document.createElement('div');
        ghost.className = 'calendar-ghost-block absolute left-1 right-1 rounded-md border-2 border-dashed border-indigo-400 bg-indigo-500/25 text-indigo-100 p-1.5 pointer-events-none z-30 flex flex-col justify-between shadow-lg backdrop-blur-[1px]';
        col.appendChild(ghost);
    }
    const topPx = Math.max(0, ((startTotalMin - START_HOUR * 60) / 60) * HOUR_HEIGHT);
    const heightPx = (durationMin / 60) * HOUR_HEIGHT;
    ghost.style.top = `${topPx}px`;
    ghost.style.height = `${heightPx - 2}px`;
    ghost.innerHTML = `
        <div class="text-[11px] font-extrabold truncate">🎯 ${draggedMatch ? (draggedMatch.groupName || draggedMatch.teamLabel) : 'Déplacer ici'}</div>
        <div class="text-[10px] font-mono font-bold text-indigo-200">${timeStr} → ${endStr} (${formatDurationLabel(durationMin)})</div>
    `;

    const dObj = parseLocalISO(dateIso);
    const dateFormatted = dObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
    showDragTooltip(event.clientX, event.clientY, `${dateFormatted} • ${timeStr} → ${endStr}`);
}

function handleCalendarDragLeave(event) {
    const col = event.currentTarget;
    if (col && !col.contains(event.relatedTarget)) {
        col.classList.remove('calendar-col-active');
        const ghost = col.querySelector('.calendar-ghost-block');
        if (ghost) ghost.remove();
    }
}

function handleCalendarDrop(event, targetDateIso) {
    event.preventDefault();
    document.querySelectorAll('.calendar-col-active').forEach(el => el.classList.remove('calendar-col-active'));
    removeGhostBlocks();
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

    const actuallyMoved = (targetDateIso !== m.date || newHoraire !== m.horaire);
    if (!actuallyMoved) return;

    m.date = targetDateIso;
    m.horaire = newHoraire;

    if (m.isManual) {
        m.origDate = targetDateIso;
        m.origHoraire = newHoraire;
        m.derogationNeeded = false;
        m.derogationDone = false;
    } else {
        const differsFromOriginal = (
            targetDateIso !== (m.origDate || m.date) ||
            newHoraire !== (m.origHoraire || m.horaire) ||
            m.salle !== (m.origSalle || m.salle)
        );
        if (differsFromOriginal) {
            m.derogationNeeded = true;
            m.derogationDone = false;
        } else {
            m.derogationNeeded = false;
            m.derogationDone = false;
        }
    }

    customOverrides[matchId] = {
        date: m.date,
        horaire: m.horaire,
        duration: m.duration,
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

function showDragTooltip(x, y, text) {
    let tooltip = document.getElementById('drag-tooltip-live');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'drag-tooltip-live';
        tooltip.className = 'fixed z-50 bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xl pointer-events-none transition-transform duration-75 flex items-center gap-1.5 border border-indigo-400';
        document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = `<i class="fa-regular fa-clock"></i> <b>${text}</b>`;
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
 * VUE 1 : CALENDAR (1 JOUR MOBILE, 3 JOURS WEEK-END, OU 7 JOURS + ENTRAÎNEMENTS & VACANCES)
 */
function renderCalendar() {
    const container = document.getElementById('view-container');
    const dayPillsEl = document.getElementById('mobile-day-pills');
    if (!container) return;

    if (appData.matches.length === 0 && (!trainingSlots || trainingSlots.length === 0)) {
        if (dayPillsEl) {
            dayPillsEl.classList.add('hidden');
            dayPillsEl.classList.remove('grid');
        }
        container.innerHTML = `
            <div class="py-14 sm:py-20 px-4 sm:px-6 text-center text-neutral-300 bg-[#1a1a1a] rounded-2xl border border-neutral-800 shadow-lg max-w-2xl mx-auto my-4 space-y-4">
                <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto text-2xl sm:text-3xl">
                    <i class="fa-solid fa-file-excel"></i>
                </div>
                <h2 class="font-extrabold text-white text-base sm:text-lg">Bienvenue sur Sport Planner — Multi-Club (Hors-ligne)</h2>
                <p class="text-xs text-neutral-400 leading-relaxed max-w-lg mx-auto">
                    Cet outil fonctionne 100 % en local dans votre navigateur (ordinateur ou smartphone).
                    Exportez vos rencontres depuis <b>FBI (Rechercher Rencontre → Exporter Excel)</b> puis cliquez sur <b>« Importer (.xlsx / .json) »</b> ou configurez vos <b>« Entraînements »</b>.
                </p>
            </div>`;
        return;
    }

    if (!currentWeekStart) currentWeekStart = getMonday(new Date());

    const allWeekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(currentWeekStart);
        d.setDate(d.getDate() + i);
        allWeekDays.push(d);
    }

    const filtered = getFilteredMatches();

    if (dayPillsEl) {
        if (calendarDaysMode === '1d') {
            dayPillsEl.classList.remove('hidden');
            dayPillsEl.classList.add('grid');
            dayPillsEl.innerHTML = allWeekDays.map((d, idx) => {
                const iso = toLocalISO(d);
                const trnCount = showTrainingsOnCalendar ? getTrainingInstancesForDate(iso).length : 0;
                const count = filtered.filter(m => m.date === iso).length + trnCount;
                const hasClosure = getClosuresForDate(iso).length > 0;
                const hol = getHolidayStatusForDate(iso);
                const isSelected = idx === selectedDayIndex;
                const shortDay = d.toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3).toUpperCase();
                return `
                    <button type="button" onclick="selectMobileDay(${idx})"
                            class="py-1.5 px-1 rounded-lg text-center transition flex flex-col items-center justify-center ${
                                isSelected
                                    ? 'bg-indigo-600 text-white font-bold shadow'
                                    : (count > 0 ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'bg-transparent text-neutral-500 hover:text-neutral-300')
                            }">
                        <span class="text-[10px] tracking-tighter">${shortDay} ${hasClosure ? '🚫' : (hol.isPublicHoliday ? '🎌' : (hol.isSchoolHoliday ? '🏖️' : ''))}</span>
                        <span class="text-xs font-extrabold">${d.getDate()}</span>
                        ${count > 0 ? `<span class="mt-0.5 text-[9px] px-1.5 rounded-full ${isSelected ? 'bg-white text-indigo-700' : 'bg-indigo-950 text-indigo-300'} font-bold">${count}</span>` : `<span class="mt-0.5 text-[9px] opacity-0">0</span>`}
                    </button>
                `;
            }).join('');
        } else {
            dayPillsEl.classList.add('hidden');
            dayPillsEl.classList.remove('grid');
        }
    }

    let days = allWeekDays;
    let gridClass = 'calendar-grid-7';
    let minWidthClass = 'min-w-[980px]';

    if (calendarDaysMode === '3d') {
        days = allWeekDays.slice(4, 7);
        gridClass = 'calendar-grid-3';
        minWidthClass = 'min-w-full sm:min-w-[640px]';
    } else if (calendarDaysMode === '1d') {
        days = [allWeekDays[selectedDayIndex] || allWeekDays[5]];
        gridClass = 'calendar-grid-1';
        minWidthClass = 'min-w-full';
    }

    const startStr = allWeekDays[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const endStr = allWeekDays[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const weekLabelEl = document.getElementById('current-week-label');
    if (weekLabelEl) weekLabelEl.textContent = `${startStr} – ${endStr}`;
    const weekJumpEl = document.getElementById('week-jump');
    if (weekJumpEl) weekJumpEl.value = toLocalISO(allWeekDays[0]);

    const hours = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);
    const todayIso = toLocalISO(new Date());

    container.innerHTML = `
        <div class="bg-[#181818] rounded-xl border border-neutral-800 shadow-2xl overflow-hidden flex flex-col">
            <div class="${gridClass} bg-[#1f1f1f] border-b border-neutral-800 text-center sticky top-0 z-20">
                <div class="py-2.5 border-r border-neutral-800 text-[9px] sm:text-[10px] font-medium text-neutral-500 flex items-end justify-center pb-2">
                    ${calendarDaysMode === '1d' ? '1 JOUR' : (calendarDaysMode === '3d' ? 'VEN–DIM' : '7 JOURS')}
                </div>
                ${days.map(d => {
                    const dateIso = toLocalISO(d);
                    const isToday = dateIso === todayIso;
                    const dayName = d.toLocaleDateString('fr-FR', { weekday: calendarDaysMode === '1d' ? 'long' : 'short' }).toUpperCase();
                    const dayNum = d.getDate();
                    const dayTrainings = showTrainingsOnCalendar ? getTrainingInstancesForDate(dateIso) : [];
                    const countDay = filtered.filter(m => m.date === dateIso).length + dayTrainings.length;
                    const dayClosures = getClosuresForDate(dateIso);
                    const hol = getHolidayStatusForDate(dateIso);

                    return `
                        <div class="py-2 border-r border-neutral-800 last:border-r-0 ${isToday ? 'bg-indigo-950/30' : (dayClosures.length > 0 ? 'bg-rose-950/20' : '')}">
                            <span class="block text-[10px] sm:text-[11px] font-semibold tracking-wider ${isToday ? 'text-indigo-400' : 'text-neutral-400'}">${dayName}</span>
                            <div class="mt-0.5 flex items-center justify-center gap-1.5">
                                <span class="text-base sm:text-xl font-normal ${isToday ? 'bg-indigo-600 text-white rounded-full w-7 h-7 sm:w-8 sm:h-8 inline-flex items-center justify-center font-bold' : 'text-neutral-200'}">${dayNum}</span>
                                ${countDay > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-semibold">${countDay}</span>` : ''}
                            </div>
                            ${dayClosures.length > 0 ? `
                                <div class="mt-1 px-1">
                                    <span class="inline-block text-[9px] px-1.5 py-0.5 rounded bg-rose-900/80 text-rose-200 border border-rose-700 font-bold truncate max-w-full" title="${dayClosures.map(c => c.gymName + ' : ' + c.reason).join(' | ')}">
                                        🚫 ${dayClosures[0].gymName} fermé
                                    </span>
                                </div>
                            ` : ''}
                            ${hol.isPublicHoliday ? `
                                <div class="mt-1 px-1">
                                    <span class="inline-block text-[9px] px-1.5 py-0.5 rounded bg-amber-900/80 text-amber-200 border border-amber-700 font-bold truncate max-w-full" title="Jour férié : ${hol.publicName}">
                                        🎌 ${hol.publicName}
                                    </span>
                                </div>
                            ` : (hol.isSchoolHoliday ? `
                                <div class="mt-1 px-1">
                                    <span class="inline-block text-[9px] px-1.5 py-0.5 rounded bg-teal-950/90 text-teal-300 border border-teal-800 font-semibold truncate max-w-full" title="${hol.schoolName} (Zone ${schoolZone}) — Entraînements suspendus">
                                        🏖️ ${hol.schoolName}
                                    </span>
                                </div>
                            ` : '')}
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="relative overflow-x-auto overflow-y-auto max-h-[72vh] sm:max-h-[760px]">
                <div class="${gridClass} relative ${minWidthClass}">
                    <div class="border-r border-neutral-800 bg-[#161616] select-none">
                        ${hours.map(h => `
                            <div style="height: ${HOUR_HEIGHT}px;" class="border-b border-neutral-800/80 text-[10px] sm:text-[11px] text-neutral-400 text-right pr-1.5 sm:pr-2.5 pt-1 font-mono">
                                ${String(h).padStart(2, '0')}:00
                            </div>
                        `).join('')}
                    </div>

                    ${days.map(d => {
                        const dateIso = toLocalISO(d);
                        const dayMatches = filtered.filter(m => m.date === dateIso);
                        const dayTrainings = showTrainingsOnCalendar ? getTrainingInstancesForDate(dateIso) : [];
                        const positionedMatches = layoutDayEvents([...dayMatches, ...dayTrainings]);
                        const dayClosures = getClosuresForDate(dateIso);

                        return `
                            <div class="border-r border-neutral-800 last:border-r-0 relative ${dayClosures.length > 0 ? 'bg-[#1a1214]' : 'bg-[#141414]'}"
                                 ondragover="handleCalendarDragOver(event, '${dateIso}')"
                                 ondragleave="handleCalendarDragLeave(event)"
                                 ondrop="handleCalendarDrop(event, '${dateIso}')">
                                
                                ${hours.map(() => `<div style="height: ${HOUR_HEIGHT}px;" class="border-b border-neutral-800/70 pointer-events-none"></div>`).join('')}

                                ${positionedMatches.map(m => {
                                    const dur = getMatchDuration(m);
                                    const topOffset = Math.max(0, ((m.startM - (START_HOUR * 60)) / 60) * HOUR_HEIGHT);
                                    const heightPx = (dur / 60) * HOUR_HEIGHT;
                                    const endH = minutesToTime(m.endM);

                                    const colW = 100 / m.totalCols;
                                    const leftPercent = m.colIndex * colW;
                                    const widthCalc = m.totalCols > 1 ? `calc(${colW}% - 4px)` : `calc(100% - 6px)`;
                                    const leftCalc = m.totalCols > 1 ? `calc(${leftPercent}% + 2px)` : `3px`;

                                    const isCoachConflict = conflictingCoachMatchIds.has(m.id);
                                    const conflictingNames = (matchConflictingCoachNames.get(m.id) || []).join(', ');

                                    if (m.isTraining) {
                                        const trnGymNorm = normalizeGymName(m.salle);
                                        const isTrnClosed = dayClosures.some(c => {
                                            const cg = normalizeGymName(c.gymName);
                                            return !cg || cg === 'TOUS' || trnGymNorm.includes(cg) || cg.includes(trnGymNorm);
                                        });
                                        const trnStyle = isTrnClosed
                                            ? 'bg-rose-950/90 text-rose-200 border-rose-500 border-dashed'
                                            : (isCoachConflict
                                                ? 'bg-purple-950/90 text-purple-100 border-purple-500 border-dashed ring-2 ring-purple-500'
                                                : 'bg-teal-950/85 text-teal-100 border-teal-600/80 border-dashed hover:brightness-110');

                                        return `
                                            <div onclick="openTrainingsModal()"
                                                 style="top: ${topOffset}px; height: ${heightPx - 2}px; left: ${leftCalc}; width: ${widthCalc}; z-index: ${5 + m.colIndex};"
                                                 class="absolute rounded-md p-1.5 border-2 shadow-sm cursor-pointer transition flex flex-col justify-between overflow-hidden ${trnStyle}"
                                                 title="Entraînement hebdomadaire : ${m.groupName} (${m.horaire}–${endH}) - Cliquer pour gérer les entraînements">
                                                <div class="leading-tight overflow-hidden">
                                                    <div class="flex items-center justify-between gap-1">
                                                        <span class="font-extrabold text-[10px] truncate">🏋️ ${m.groupName}</span>
                                                        ${isTrnClosed ? `<span class="bg-rose-700 text-white text-[8px] font-bold px-1 rounded">🚫 FERMÉ</span>` : (isCoachConflict ? `<span class="bg-purple-700 text-white text-[8px] font-bold px-1 rounded">COACH</span>` : `<span class="bg-teal-800/80 text-teal-200 text-[8px] font-bold px-1 rounded">ENTRAÎN.</span>`)}
                                                    </div>
                                                    <p class="text-[9px] font-mono font-semibold opacity-90 mt-0.5">${m.horaire}–${endH} (${formatDurationLabel(dur)})</p>
                                                    <p class="text-[9px] truncate opacity-85">📍 ${m.salle}</p>
                                                    ${m.coach ? `<p class="text-[9px] truncate opacity-85">👟 ${m.coach}</p>` : ''}
                                                </div>
                                            </div>
                                        `;
                                    }

                                    const isClosedConflict = closureConflictMatchIds.has(m.id);
                                    const isGymConflict = conflictingGymMatchIds.has(m.id);

                                    const cardStyle = isClosedConflict
                                        ? 'bg-rose-700 text-white border-rose-400 hover:brightness-105'
                                        : (m.isHome
                                            ? 'bg-[#b39ddb] text-slate-950 border-[#9575cd] hover:brightness-105'
                                            : 'bg-[#e06641] text-slate-950 border-[#c8502b] hover:brightness-105');

                                    const conflictRing = isClosedConflict
                                        ? 'ring-2 ring-rose-400 border-rose-300'
                                        : (isGymConflict
                                            ? 'ring-2 ring-rose-500 border-rose-500'
                                            : (isCoachConflict ? 'ring-2 ring-purple-500 border-purple-500' : ''));

                                    const showPendingDerogBanner = !m.isManual && m.derogationNeeded && !m.derogationDone;
                                    const mapsUrl = getMapsUrl(m.salle);

                                    return `
                                        <div draggable="true"
                                             ondragstart="handleCalendarMatchDragStart(event, '${m.id}')"
                                             ondragend="handleCalendarMatchDragEnd(event)"
                                             onclick="openModal('${m.id}')"
                                             style="top: ${topOffset}px; height: ${heightPx - 2}px; left: ${leftCalc}; width: ${widthCalc}; z-index: ${10 + m.colIndex};"
                                             class="absolute rounded-md p-1.5 border shadow-md cursor-pointer md:cursor-grab active:cursor-grabbing transition flex flex-col justify-between overflow-hidden ${cardStyle} ${conflictRing}"
                                             title="Toucher ou cliquer pour éditer : ${m.groupName || m.teamLabel} vs ${m.opponent}">
                                            
                                            <div class="leading-tight overflow-hidden">
                                                <div class="flex items-center justify-between gap-1 pointer-events-none">
                                                    <span class="font-extrabold text-[11px] truncate">
                                                        ${m.isHome ? '🏠' : '✈️'} ${m.groupName || m.teamLabel}
                                                    </span>
                                                    <div class="flex items-center gap-0.5 shrink-0">
                                                        ${m.isManual ? `<span class="bg-violet-900 text-violet-100 text-[8px] font-bold px-1 rounded">HORS-FBI</span>` : ''}
                                                        ${isClosedConflict ? `<span class="bg-black text-rose-300 text-[8px] font-bold px-1 rounded">🚫 FERMÉ</span>` : ''}
                                                        ${isGymConflict ? `<span class="bg-rose-600 text-white text-[8px] font-bold px-1 rounded">SALLE</span>` : ''}
                                                        ${isCoachConflict ? `<span class="bg-purple-700 text-white text-[8px] font-bold px-1 rounded" title="Conflit pour : ${conflictingNames}">COACH</span>` : ''}
                                                    </div>
                                                </div>
                                                <p class="font-bold text-[10px] truncate opacity-95 pointer-events-none">vs ${m.opponent}</p>
                                                <p class="text-[10px] font-semibold opacity-85 mt-0.5 pointer-events-none">${m.horaire}–${endH} (${formatDurationLabel(dur)}) • <span class="underline">${m.teamLabel}</span></p>
                                                <a href="${mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Ouvrir ${m.salle} dans Google Maps" class="text-[9px] truncate opacity-85 hover:opacity-100 hover:underline flex items-center gap-1 mt-0.5">
                                                    <i class="fa-solid fa-location-dot text-[8px]"></i> <span class="truncate">${m.salle}</span>
                                                </a>
                                                ${m.coach ? `<p class="text-[9px] font-bold truncate opacity-85 pointer-events-none">👟 ${m.coach}</p>` : ''}
                                            </div>

                                            ${isClosedConflict ? `
                                                <div class="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/80 text-rose-200 truncate pointer-events-none">
                                                    🚫 Gymnase fermé (Mairie) !
                                                </div>
                                            ` : (showPendingDerogBanner ? `
                                                <div onclick="event.stopPropagation()" class="mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center justify-between bg-amber-950 text-amber-200">
                                                    <span class="truncate">⚠️ Dérog. à faire !</span>
                                                    <input type="checkbox" onchange="toggleDerogation('${m.id}', this.checked)" class="rounded w-3.5 h-3.5 cursor-pointer ml-1 shrink-0">
                                                </div>
                                            ` : '')}
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
 * VUE 2 : VUE LISTE MODERNE (CARTES EMPILÉES SUR MOBILE, TABLEAU SUR DESKTOP, GROUPEMENT PAR COACH POSSIBLE)
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

    const addMatchToGroup = (key, title, subtitle, matchObj) => {
        if (!groupsMap.has(key)) {
            groupsMap.set(key, { key, title, subtitle, items: [] });
        }
        groupsMap.get(key).items.push(matchObj);
    };

    matches.forEach(m => {
        if (groupBy === 'coach') {
            const coaches = parseCoachList(m.coach);
            if (coaches.length === 0) {
                addMatchToGroup('ZZ_NO_COACH', '👟 Sans coach renseigné', '', m);
            } else {
                // Un match ayant 2 coachs (ex: Coach principal + Assistant) apparaît dans le planning de chacun des deux
                coaches.forEach(cObj => {
                    const knownEntry = getKnownCoachesMap().get(cObj.norm);
                    const teamsHint = knownEntry ? `Équipes : ${Array.from(knownEntry.teams).join(' • ')}` : '';
                    addMatchToGroup(`COACH_${cObj.norm}`, `👟 ${cObj.displayName}`, teamsHint, m);
                });
            }
            return;
        }

        let key = 'ALL';
        let title = 'Toutes les rencontres';
        let subtitle = '';

        if (groupBy === 'team') {
            key = m.groupId || m.teamId;
            title = m.groupName || m.teamLabel;
            const pools = getPoolsForGroup(key).map(p => p.label);
            subtitle = pools.length > 0 ? `Poules regroupées : ${pools.join(' • ')}` : `Poule / Catégorie : ${m.teamLabel}`;
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
            const isClosedConflict = closureConflictMatchIds.has(m.id);
            const isGymConflict = conflictingGymMatchIds.has(m.id);
            const isCoachConflict = conflictingCoachMatchIds.has(m.id);
            if (isClosedConflict) {
                key = '0_CLOSURE';
                title = '🚫 Matchs programmés sur un gymnase fermé (Mairie / Travaux)';
            } else if (isGymConflict || isCoachConflict) {
                key = '1_CONFLICT';
                title = '🚨 Conflits détectés (Salle ou Entraîneur)';
            } else if (!m.isManual && m.derogationNeeded && !m.derogationDone) {
                key = '2_DEROG_TODO';
                title = '⚠️ Dérogations à faire';
            } else if (!m.isManual && m.derogationNeeded && m.derogationDone) {
                key = '3_DEROG_DONE';
                title = '⏳ Dérogations en cours / envoyées (en attente FBI)';
            } else {
                key = '4_NORMAL';
                title = '📅 Rencontres sans alerte';
            }
        }

        addMatchToGroup(key, title, subtitle, m);
    });

    let groupsArray = Array.from(groupsMap.values());
    if (groupBy === 'team' || groupBy === 'coach') {
        groupsArray.sort((a, b) => a.key.localeCompare(b.key));
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
                        <div onclick="toggleGroupCollapse('${grp.key}')" class="bg-[#202020] hover:bg-[#262626] px-3.5 sm:px-5 py-3 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none transition">
                            <div class="flex items-center gap-2.5">
                                <i class="fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'} text-neutral-400 text-xs w-4"></i>
                                <div>
                                    <h3 class="font-bold text-xs sm:text-sm text-white flex items-center gap-2">
                                        ${grp.title}
                                    </h3>
                                    ${grp.subtitle ? `<p class="text-[11px] text-amber-400/90 font-medium">${grp.subtitle}</p>` : ''}
                                </div>
                            </div>
                            <div class="flex items-center gap-1.5 text-[11px] sm:text-xs">
                                <span class="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-semibold">
                                    ${grp.items.length} m.
                                </span>
                                <span class="px-2 py-0.5 rounded-full bg-[#b39ddb]/20 text-[#b39ddb] border border-[#b39ddb]/30 font-semibold">
                                    🏠 ${domCount}
                                </span>
                            </div>
                        </div>

                        <div class="${isCollapsed ? 'hidden' : 'block'}">
                            <table class="w-full text-left border-collapse block md:table">
                                <thead class="hidden md:table-header-group">
                                    <tr class="bg-[#141414] text-[11px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
                                        <th class="py-2.5 px-4">Date & Créneau</th>
                                        <th class="py-2.5 px-4">Lieu</th>
                                        <th class="py-2.5 px-4">Équipe & Poule FBI</th>
                                        <th class="py-2.5 px-4">Adversaire / Score</th>
                                        <th class="py-2.5 px-4">Salle (GPS) & Coach(s)</th>
                                        <th class="py-2.5 px-4">Statut / Dérogation</th>
                                        <th class="py-2.5 px-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-800/70 text-xs block md:table-row-group">
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
    const dur = getMatchDuration(m);
    const endH = minutesToTime(timeToMinutes(m.horaire) + dur);
    const isClosedConflict = closureConflictMatchIds.has(m.id);
    const isGymConflict = conflictingGymMatchIds.has(m.id);
    const isCoachConflict = conflictingCoachMatchIds.has(m.id);
    const conflictingNames = (matchConflictingCoachNames.get(m.id) || []).join(', ');
    const parsedCoaches = parseCoachList(m.coach);

    const rowBg = (isClosedConflict || isGymConflict || isCoachConflict)
        ? 'bg-rose-950/30 hover:bg-rose-950/50'
        : 'hover:bg-[#222222]';
    const mapsUrl = getMapsUrl(m.salle);

    return `
        <tr class="${rowBg} transition flex flex-col md:table-row p-3.5 md:p-0 gap-2 md:gap-0">
            <td class="md:py-3 md:px-4 whitespace-nowrap flex items-center justify-between md:table-cell">
                <div>
                    <div class="font-bold text-white">${dateFormatted}</div>
                    <div class="text-[11px] text-indigo-400 font-mono font-semibold">
                        <i class="fa-regular fa-clock mr-1"></i>${m.horaire} → ${endH} <span class="text-neutral-500">(${formatDurationLabel(dur)})</span>
                    </div>
                </div>
                <span class="md:hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold ${m.isHome ? 'bg-[#b39ddb] text-slate-950' : 'bg-[#e06641] text-slate-950'}">
                    ${m.isHome ? '🏠 Domicile' : '✈️ Extérieur'}
                </span>
            </td>

            <td class="hidden md:table-cell md:py-3 md:px-4 whitespace-nowrap">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold ${m.isHome ? 'bg-[#b39ddb] text-slate-950' : 'bg-[#e06641] text-slate-950'}">
                    ${m.isHome ? '🏠 Domicile' : '✈️ Extérieur'}
                </span>
            </td>

            <td class="md:py-3 md:px-4 block md:table-cell">
                <div class="font-bold text-white text-xs inline md:block">${m.groupName || m.teamLabel}</div>
                <span class="inline-block ml-1.5 md:ml-0 md:mt-0.5 text-[10px] px-1.5 py-0.2 ${m.isManual ? 'bg-violet-950 text-violet-300 border-violet-700' : 'bg-neutral-800 text-amber-300 border-neutral-700'} border rounded font-medium">
                    ${m.isManual ? `📌 Hors-FBI : ${m.competition}` : `Poule : ${m.teamLabel}`}
                </span>
            </td>

            <td class="md:py-3 md:px-4 block md:table-cell">
                <div class="font-semibold text-neutral-200">vs <span class="text-white font-bold">${m.opponent}</span></div>
                ${m.joue && m.score1 !== null && m.score2 !== null ? `
                    <span class="inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-emerald-400 font-mono font-bold">
                        Score : ${m.score1} - ${m.score2}
                    </span>
                ` : `<span class="text-[10px] text-neutral-500">${m.isManual ? 'Événement manuel' : `Match N° ${m.numero}`}</span>`}
            </td>

            <td class="md:py-3 md:px-4 block md:table-cell">
                <a href="${mapsUrl}" target="_blank" rel="noopener" class="text-neutral-300 hover:text-indigo-400 inline-flex items-center gap-1.5 group transition" title="Ouvrir dans Google Maps">
                    <i class="fa-solid fa-map-location-dot text-indigo-400 md:text-neutral-500 group-hover:text-indigo-400"></i>
                    <span class="truncate max-w-[260px] md:max-w-[220px] underline md:no-underline group-hover:underline">${m.salle}</span>
                </a>
                ${parsedCoaches.length > 0 ? `
                    <div class="flex flex-wrap gap-1 mt-1">
                        ${parsedCoaches.map(c => `
                            <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold ${c.role ? 'bg-purple-950/80 text-purple-200 border border-purple-700/60' : 'bg-indigo-950/80 text-indigo-200 border border-indigo-700/60'}">
                                👟 ${c.displayName}${c.role ? ` (${c.role})` : ''}
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </td>

            <td class="md:py-3 md:px-4 whitespace-nowrap block md:table-cell">
                <div class="flex flex-wrap md:flex-col gap-1">
                    ${isClosedConflict ? `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-700 text-white border border-rose-400 w-fit">
                            <i class="fa-solid fa-ban"></i> Gymnase Fermé [${m.salle}]
                        </span>
                    ` : ''}
                    ${isGymConflict ? `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white w-fit">
                            <i class="fa-solid fa-triangle-exclamation"></i> Conflit Salle [${m.salle}]
                        </span>
                    ` : ''}
                    ${isCoachConflict ? `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-700 text-white w-fit">
                            <i class="fa-solid fa-user-clock"></i> Conflit Coach (${conflictingNames || m.coach})
                        </span>
                    ` : ''}

                    ${!m.isManual && m.derogationNeeded && !m.derogationDone ? `
                        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded border text-[11px] font-bold w-fit bg-amber-950/80 border-amber-600 text-amber-300">
                            <span>⚠️ Dérogation à faire !</span>
                            <input type="checkbox" onchange="toggleDerogation('${m.id}', this.checked)" class="rounded bg-neutral-900 border-neutral-600 text-emerald-500 w-4 h-4 cursor-pointer">
                        </div>
                    ` : (!m.isManual && m.derogationNeeded && m.derogationDone ? `
                        <div class="inline-flex items-center gap-2 text-[11px] text-neutral-400 w-fit" title="Horaire FBI initial : ${m.origDate} à ${m.origHoraire}">
                            <span>✅ Modifié (en cours FBI)</span>
                            <input type="checkbox" checked onchange="toggleDerogation('${m.id}', this.checked)" class="rounded bg-neutral-900 border-neutral-700 text-emerald-500 w-3.5 h-3.5 cursor-pointer">
                        </div>
                    ` : (!isClosedConflict && !isGymConflict && !isCoachConflict ? `<span class="text-[11px] text-neutral-500 hidden md:inline">RAS</span>` : ''))}
                </div>
            </td>

            <td class="md:py-3 md:px-4 whitespace-nowrap text-right block md:table-cell pt-1 md:pt-3 border-t border-neutral-800/60 md:border-t-0">
                <div class="flex md:inline-flex items-center justify-end gap-2">
                    <button onclick="goToMatchWeek('${m.date}')" title="Voir sur la grille Calendar" class="flex-1 md:flex-none py-1.5 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition text-xs flex items-center justify-center gap-1">
                        <i class="fa-solid fa-calendar-week"></i> <span class="md:hidden">Calendrier</span>
                    </button>
                    <button onclick="openModal('${m.id}')" class="flex-1 md:flex-none py-1.5 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 font-semibold transition text-xs flex items-center justify-center gap-1">
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
    customOverrides[id] = customOverrides[id] || {
        date: m.date,
        horaire: m.horaire,
        duration: m.duration,
        salle: m.salle,
        coach: m.coach || '',
        derogationNeeded: m.derogationNeeded
    };
    customOverrides[id].derogationDone = isChecked;
    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));
    detectConflictsAndDerogations();
    renderView();
}

function appendCoachToModalInput(coachName) {
    const input = document.getElementById('edit-coach');
    if (!input) return;
    const existing = parseCoachList(input.value);
    if (existing.some(c => c.norm === coachName.toUpperCase())) return;
    input.value = input.value.trim() ? `${input.value.trim()}, ${coachName}` : coachName;
}

function openModal(id) {
    const m = appData.matches.find(x => x.id === id);
    if (!m) return;

    ensureKnownGymsDatalist();

    const modalId = document.getElementById('edit-match-id');
    const modalTeam = document.getElementById('edit-team-label');
    const modalDate = document.getElementById('edit-date');
    const modalHoraire = document.getElementById('edit-horaire');
    const modalDuration = document.getElementById('edit-duration');
    const modalSalle = document.getElementById('edit-salle');
    const modalCoach = document.getElementById('edit-coach');
    const coachChipsEl = document.getElementById('edit-coach-chips');
    const modalDerogDone = document.getElementById('edit-derogation-done');
    const statusSpan = document.getElementById('modal-derogation-status');
    const restoreBtn = document.querySelector('button[onclick="restoreMatchOriginal()"]');

    if (modalId) modalId.value = m.id;
    if (modalTeam) modalTeam.value = `${m.isHome ? '[DOMICILE]' : '[EXTÉRIEUR]'} ${m.groupName || m.teamLabel} (${m.teamLabel}) vs ${m.opponent}`;
    if (modalDate) modalDate.value = m.date;
    if (modalHoraire) modalHoraire.value = m.horaire;
    if (modalDuration) modalDuration.value = String(getMatchDuration(m));
    if (modalSalle) modalSalle.value = m.salle;
    if (modalCoach) modalCoach.value = m.coach || '';
    if (modalDerogDone) modalDerogDone.checked = Boolean(m.derogationDone);

    // Pastilles d'ajout rapide des coachs déjà connus dans le club
    if (coachChipsEl) {
        const knownCoaches = Array.from(getKnownCoachesMap().values());
        if (knownCoaches.length > 0) {
            coachChipsEl.innerHTML = `<span class="text-[10px] text-neutral-500 mr-1 self-center">Ajout rapide :</span>` +
                knownCoaches.map(c => `
                    <button type="button" onclick="appendCoachToModalInput('${c.displayName.replace(/'/g, "\\'")}')"
                            class="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 hover:bg-indigo-600 text-neutral-300 hover:text-white border border-neutral-700 transition">
                        + ${c.displayName}
                    </button>
                `).join('');
        } else {
            coachChipsEl.innerHTML = '';
        }
    }

    if (restoreBtn) {
        if (m.isManual) {
            restoreBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Supprimer l'événement`;
        } else {
            restoreBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Horaire initial`;
        }
    }

    if (statusSpan) {
        if (m.isManual) {
            statusSpan.textContent = "📌 Événement créé manuellement (hors-FBI). Aucune dérogation fédérale requise.";
        } else if (m.derogationNeeded) {
            statusSpan.textContent = `Horaire initial FBI : ${m.origDate} à ${m.origHoraire} (${m.origSalle})`;
        } else {
            statusSpan.textContent = "Aucun changement d'horaire/salle par rapport au fichier FBI.";
        }
    }

    const editModal = document.getElementById('edit-modal');
    if (editModal) editModal.classList.remove('hidden');
}

function openMapsFromModal() {
    const salleVal = document.getElementById('edit-salle')?.value;
    window.open(getMapsUrl(salleVal), '_blank', 'noopener');
}

function closeModal() {
    const editModal = document.getElementById('edit-modal');
    if (editModal) editModal.classList.add('hidden');
}

function restoreMatchOriginal() {
    const id = document.getElementById('edit-match-id')?.value;
    const m = appData.matches.find(x => x.id === id);
    if (!m) return;

    if (m.isManual) {
        if (!confirm("Voulez-vous supprimer définitivement cet événement hors-FBI ?")) return;
        appData.matches = appData.matches.filter(x => x.id !== id);
        delete customOverrides[id];
        localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
        localStorage.setItem('espm_custom_data', JSON.stringify(appData));
        closeModal();
        updateClubHeaderUI();
        initTeamFilter();
        initCoachFilter();
        initWeekSelector();
        detectConflictsAndDerogations();
        renderView();
        return;
    }

    m.date = m.origDate || m.date;
    m.horaire = m.origHoraire || m.horaire;
    m.salle = m.origSalle || m.salle;
    m.derogationNeeded = false;
    m.derogationDone = false;

    delete customOverrides[id];
    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));

    closeModal();
    initCoachFilter();
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
    const newDuration = Number(document.getElementById('edit-duration')?.value) || 120;
    const newSalle = (document.getElementById('edit-salle')?.value || '').trim();
    const newCoach = (document.getElementById('edit-coach')?.value || '').trim();
    const derogDoneCheckbox = document.getElementById('edit-derogation-done')?.checked || false;

    m.date = newDate;
    m.horaire = newHoraire;
    m.duration = newDuration;
    m.salle = newSalle;
    m.coach = newCoach;

    if (m.isManual) {
        m.origDate = newDate;
        m.origHoraire = newHoraire;
        m.origSalle = newSalle;
        m.derogationNeeded = false;
        m.derogationDone = false;
    } else {
        const differsFromOriginal = (
            newDate !== (m.origDate || m.date) ||
            newHoraire !== (m.origHoraire || m.horaire) ||
            newSalle !== (m.origSalle || m.salle)
        );
        if (differsFromOriginal) {
            m.derogationNeeded = true;
            m.derogationDone = derogDoneCheckbox;
        } else {
            m.derogationNeeded = false;
            m.derogationDone = false;
        }
    }

    customOverrides[id] = {
        date: m.date,
        horaire: m.horaire,
        duration: m.duration,
        salle: m.salle,
        coach: m.coach,
        derogationNeeded: m.derogationNeeded,
        derogationDone: m.derogationDone
    };

    localStorage.setItem('espm_overrides', JSON.stringify(customOverrides));
    localStorage.setItem('espm_custom_data', JSON.stringify(appData));

    closeModal();
    initCoachFilter();
    initWeekSelector();
    detectConflictsAndDerogations();
    renderView();
}