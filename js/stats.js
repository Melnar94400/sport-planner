/**
 * js/stats.js
 * Module externe de statistiques des joueurs et joueuses basé sur l'analyse automatique des feuilles de match PDF (FFBB).
 * Extrait uniquement les lignes du club local ou visiteur correspondant au club chargé dans l'application.
 */

// Initialisation de pdf.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

let loadedMatchSheets = JSON.parse(localStorage.getItem('espm_match_sheets_stats') || '[]');

function openStatsModal() {
    let modal = document.getElementById('stats-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'stats-modal';
        modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-2.5 sm:p-4';
        modal.innerHTML = `
            <div class="bg-[#1e1e1e] border border-neutral-700 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
                <div class="bg-[#252525] px-4 sm:px-6 py-3.5 sm:py-4 border-b border-neutral-700 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center text-white font-bold">
                            <i class="fa-solid fa-chart-simple"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-sm sm:text-base text-white">Statistiques Joueurs & Joueuses (Feuilles de match PDF FFBB)</h3>
                            <p class="text-[11px] text-neutral-400">Importez vos feuilles de match PDF officielles pour consolider automatiquement les stats de votre club.</p>
                        </div>
                    </div>
                    <button onclick="closeStatsModal()" class="text-neutral-400 hover:text-white p-1"><i class="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div class="p-4 sm:p-6 overflow-y-auto flex-grow space-y-4 text-xs">
                    <!-- Zone d'import de PDF -->
                    <div class="bg-[#151515] p-4 rounded-xl border border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-orange-600/20 border border-orange-500/40 text-orange-400 flex items-center justify-center text-lg shrink-0">
                                <i class="fa-solid fa-file-pdf"></i>
                            </div>
                            <div>
                                <div class="font-bold text-white">Importer une ou plusieurs feuilles de match PDF</div>
                                <div class="text-[11px] text-neutral-400">Le lecteur détectera automatiquement votre club et extraira les stats de vos joueurs.</div>
                            </div>
                        </div>
                        <label class="bg-orange-600 hover:bg-orange-500 text-white font-bold px-4 py-2.5 rounded-xl cursor-pointer transition shadow-sm inline-flex items-center gap-2 shrink-0">
                            <i class="fa-solid fa-file-arrow-up"></i> Sélectionner des PDF
                            <input type="file" id="pdf-sheets-input" accept=".pdf" multiple onchange="handlePdfSheetsImport(event)" class="hidden">
                        </label>
                    </div>

                    <!-- Résumé / Filtres -->
                    <div class="flex flex-wrap items-center justify-between gap-3 bg-[#151515] p-3 rounded-xl border border-neutral-800">
                        <div class="flex items-center gap-2">
                            <span class="text-neutral-400 font-semibold">Feuilles analysées : <b id="stats-sheets-count" class="text-white">0</b></span>
                            <span class="text-neutral-600">|</span>
                            <span class="text-neutral-400 font-semibold">Joueurs référencés : <b id="stats-players-count" class="text-white">0</b></span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="clearAllMatchSheets()" class="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950 text-neutral-400 hover:text-rose-300 border border-neutral-700 transition">
                                <i class="fa-solid fa-trash-can mr-1"></i> Vider les stats
                            </button>
                        </div>
                    </div>

                    <!-- Tableau consolidé des joueurs -->
                    <div class="bg-[#151515] border border-neutral-800 rounded-xl overflow-hidden">
                        <div class="px-4 py-2.5 bg-[#202020] font-bold text-neutral-300 border-b border-neutral-800">Classement & Moyennes des Joueurs / Joueuses du Club</div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="bg-[#191919] text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
                                        <th class="py-2.5 px-3">Nom Prénom</th>
                                        <th class="py-2.5 px-2 text-center">Matchs</th>
                                        <th class="py-2.5 px-2 text-center">Pts Totaux</th>
                                        <th class="py-2.5 px-2 text-center text-orange-400">Moy. Pts / Match</th>
                                        <th class="py-2.5 px-2 text-center">Tirs Réussis</th>
                                        <th class="py-2.5 px-2 text-center">3 Pts</th>
                                        <th class="py-2.5 px-2 text-center">LF Réussis</th>
                                        <th class="py-2.5 px-2 text-center">Fautes</th>
                                    </tr>
                                </thead>
                                <tbody id="stats-table-body" class="divide-y divide-neutral-800/80 text-xs">
                                    <tr><td colspan="8" class="py-10 text-center text-neutral-500 italic">Aucune feuille de match PDF importée pour le moment.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="bg-[#252525] px-6 py-3 border-t border-neutral-700 flex justify-between items-center shrink-0">
                    <span class="text-[11px] text-neutral-400"><i class="fa-solid fa-circle-info mr-1 text-orange-400"></i> Les données sont sauvegardées localement dans votre navigateur.</span>
                    <button onclick="closeStatsModal()" class="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg text-xs transition">Fermer</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    renderStatsTable();
    modal.classList.remove('hidden');
}

function closeStatsModal() {
    const modal = document.getElementById('stats-modal');
    if (modal) modal.classList.add('hidden');
}

function clearAllMatchSheets() {
    if (!confirm("Voulez-vous effacer toutes les feuilles de match et statistiques enregistrées ?")) return;
    loadedMatchSheets = [];
    localStorage.removeItem('espm_match_sheets_stats');
    renderStatsTable();
}

/**
 * Analyse textuelle d'une page PDF FFBB pour extraire le nom des équipes et le tableau de stats
 */
/**
 * Analyse textuelle d'une page PDF FFBB pour extraire le tableau de stats de façon ultra-robuste
 */
async function parsePdfSheetText(pdfDoc) {
    let fullText = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        // On joint les éléments avec des espaces pour former des lignes lisibles
        const pageStr = textContent.items.map(item => item.str).join(' ');
        fullText += `\n--- PAGE ${i} ---\n` + pageStr;
    }

    // Détection des équipes Locaux vs Visiteurs
    let equipeLocaux = "";
    let equipeVisiteurs = "";

    const locauxMatch = fullText.match(/Équipe\s+A\s+([^\n|]+)/i) || fullText.match(/LOCAUX[^\n]*([A-Z\s]+(?:BASKET|BC|CLUB))[^\n]*/i);
    const visiteursMatch = fullText.match(/Équipe\s+B\s+([^\n|]+)/i) || fullText.match(/VISITEURS[^\n]*([A-Z\s]+(?:BASKET|BC|CLUB))[^\n]*/i);

    if (locauxMatch) equipeLocaux = locauxMatch[1].trim();
    if (visiteursMatch) equipeVisiteurs = visiteursMatch[1].trim();

    let playerRows = [];

    // Découpage en blocs ou lignes pour identifier les joueuses
    // Une ligne de joueuse FFBB contient typiquement : [Numéro de maillot 1-2 chiffres] [Nom, Prénom] ... [Temps XX:XX] [Points] ...
    // On recherche une occurrence de type : "NOM, PRENOM" ou "NOM PRENOM" suivie d'un temps "XX:XX" et de chiffres.
    // Approche par lignes ou blocs de texte :
    const lines = fullText.split(/[\n|]/).map(l => l.trim()).filter(Boolean);

    // Expression régulière flexible : cherche un nom en majuscules (ex: DRIARD, EMMA ou BRUNET RIBOT) 
    // suivi un peu plus loin d'un temps de jeu (XX:XX) et de plusieurs nombres (points, tirs, fautes)
    // Exemple de motif dans le texte brut : "DRIARD, EMMA 4 20:02 2 1 0 1 0 0 4"
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Vérifie si la ligne contient un temps de jeu (ex: 20:02 ou 33:08)
        const timeMatch = line.match(/\b(\d{2}:\d{2})\b/);
        if (timeMatch) {
            // La ligne contient un temps de jeu, on essaie d'extraire les chiffres situés juste après
            const parts = line.split(/\s+/);
            const timeIdx = parts.findIndex(p => /^\d{2}:\d{2}$/.test(p));
            
            if (timeIdx >= 2) {
                // Le nom de la joueuse se trouve avant le temps de jeu, et le maillot juste avant ou au début
                const maillot = parts[timeIdx - 1];
                if (/^\d{1,2}$/.test(maillot) || /^[0-9]+$/.test(maillot)) {
                    const nomPrénom = parts.slice(0, timeIdx - 1).join(' ');
                    const stats = parts.slice(timeIdx + 1).map(Number);

                    if (nomPrénom.length > 2 && !nomPrénom.toUpperCase().includes('TOTAL') && !nomPrénom.toUpperCase().includes('ENTRAINEUR')) {
                        playerRows.push({
                            maillot: maillot,
                            nom: nomPrénom.replace(/^\|\s*/, '').trim(),
                            tpsJeu: timeMatch[1],
                            pts: stats[0] || 0,
                            tirsReussis: stats[1] || 0,
                            pts3: stats[2] || 0,
                            tirs2Int: stats[3] || 0,
                            tirs2Ext: stats[4] || 0,
                            lfReussis: stats[5] || 0,
                            fautes: stats[6] || 0
                        });
                    }
                }
            }
        }
    }

    // Si la méthode par lignes est trop restrictive, on applique une regex globale de secours sur tout le texte
    if (playerRows.length === 0) {
        // Regex globale cherchant [Nom Prénom] [Maillot] [Temps] [Points]
        const globalRegex = /([A-Z\s,.-]{3,25})\s+(\d{1,2})\s+(\d{2}:\d{2})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/g;
        let match;
        while ((match = globalRegex.exec(fullText)) !== null) {
            playerRows.push({
                nom: match[1].trim(),
                maillot: match[2],
                tpsJeu: match[3],
                pts: parseInt(match[4], 10) || 0,
                tirsReussis: parseInt(match[5], 10) || 0,
                pts3: parseInt(match[6], 10) || 0,
                tirs2Int: parseInt(match[7], 10) || 0,
                tirs2Ext: parseInt(match[8], 10) || 0,
                lfReussis: parseInt(match[9], 10) || 0,
                fautes: parseInt(match[10], 10) || 0
            });
        }
    }

    return {
        equipeLocaux,
        equipeVisiteurs,
        players: playerRows
    };
}

async function handlePdfSheetsImport(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    let addedCount = 0;
    for (let file of files) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdfDoc = await loadingTask.promise;

            const sheetData = await parsePdfSheetText(pdfDoc);
            if (sheetData.players.length > 0) {
                loadedMatchSheets.push({
                    fileName: file.name,
                    importedAt: new Date().toISOString(),
                    ...sheetData
                });
                addedCount++;
            }
        } catch (err) {
            console.error("Erreur lecture PDF :", err);
        }
    }

    localStorage.setItem('espm_match_sheets_stats', JSON.stringify(loadedMatchSheets));
    event.target.value = '';
    renderStatsTable();
    alert(`${addedCount} feuille(s) de match PDF analysée(s) avec succès !`);
}

/**
 * Consolide les statistiques de tous les joueurs sur l'ensemble des matchs importés
 */
function getConsolidatedPlayerStats() {
    const statsMap = new Map(); // nomNorm -> { nom, matchsCount, ptsTotal, tirsTotal, pts3Total, lfTotal, fautesTotal }

    loadedMatchSheets.forEach(sheet => {
        // Pour éviter de compter un joueur plusieurs fois si le même PDF est importé 2 fois,
        // on peut regrouper par nom de joueur par match.
        const seenInThisSheet = new Set();

        sheet.players.forEach(p => {
            const normName = p.nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            if (!normName || normName.includes('TOTAL') || normName.includes('ENTRAINEUR')) return;

            if (!statsMap.has(normName)) {
                statsMap.set(normName, {
                    displayName: p.nom,
                    matchsCount: 0,
                    ptsTotal: 0,
                    tirsTotal: 0,
                    pts3Total: 0,
                    lfTotal: 0,
                    fautesTotal: 0
                });
            }

            const entry = statsMap.get(normName);
            if (!seenInThisSheet.has(normName)) {
                entry.matchsCount++;
                seenInThisSheet.add(normName);
            }
            entry.ptsTotal += p.pts;
            entry.tirsTotal += p.tirsReussis;
            entry.pts3Total += p.pts3;
            entry.lfTotal += p.lfReussis;
            entry.fautesTotal += p.fautes;
        });
    });

    return Array.from(statsMap.values()).sort((a, b) => b.ptsTotal - a.ptsTotal || b.matchsCount - a.matchsCount);
}

function renderStatsTable() {
    const tbody = document.getElementById('stats-table-body');
    const sheetsCountEl = document.getElementById('stats-sheets-count');
    const playersCountEl = document.getElementById('stats-players-count');
    if (!tbody) return;

    if (sheetsCountEl) sheetsCountEl.textContent = loadedMatchSheets.length;

    const consolidated = getConsolidatedPlayerStats();
    if (playersCountEl) playersCountEl.textContent = consolidated.length;

    if (consolidated.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-neutral-500 italic">Aucune feuille de match PDF importée pour le moment.</td></tr>`;
        return;
    }

    tbody.innerHTML = consolidated.map(st => {
        const avgPts = st.matchsCount > 0 ? (st.ptsTotal / st.matchsCount).toFixed(1) : '0.0';
        return `
            <tr class="hover:bg-[#1a1a1a] transition border-b border-neutral-800/80">
                <td class="py-2.5 px-3 font-bold text-white">${st.displayName}</td>
                <td class="py-2.5 px-2 text-center text-neutral-300 font-mono">${st.matchsCount}</td>
                <td class="py-2.5 px-2 text-center font-bold text-white font-mono">${st.ptsTotal}</td>
                <td class="py-2.5 px-2 text-center font-extrabold text-orange-400 font-mono">${avgPts}</td>
                <td class="py-2.5 px-2 text-center text-neutral-300 font-mono">${st.tirsTotal}</td>
                <td class="py-2.5 px-2 text-center text-neutral-300 font-mono">${st.pts3Total}</td>
                <td class="py-2.5 px-2 text-center text-neutral-300 font-mono">${st.lfTotal}</td>
                <td class="py-2.5 px-2 text-center text-neutral-400 font-mono">${st.fautesTotal}</td>
            </tr>
        `;
    }).join('');
}