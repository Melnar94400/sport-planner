/**
 * js/stats.js
 * Module externe de statistiques par extraction séquentielle des lignes du tableau VISITEURS.
 */

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
                            <h3 class="font-bold text-sm sm:text-base text-white">Statistiques par Lignes (Extraction Séquentielle FFBB)</h3>
                            <p class="text-[11px] text-neutral-400">Extrait les lignes de stats par position pour s'affranchir des erreurs d'OCR sur les noms.</p>
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
                                <div class="font-bold text-white">Importer vos feuilles de match PDF</div>
                                <div id="ocr-status-text" class="text-[11px] text-neutral-400">Prêt à l'import...</div>
                            </div>
                        </div>
                        <label class="bg-orange-600 hover:bg-orange-500 text-white font-bold px-4 py-2.5 rounded-xl cursor-pointer transition shadow-sm inline-flex items-center gap-2 shrink-0">
                            <i class="fa-solid fa-file-arrow-up"></i> Sélectionner les PDF (.pdf)
                            <input type="file" id="pdf-sheets-input" accept=".pdf" multiple onchange="handlePdfSheetsImportOCR(event)" class="hidden">
                        </label>
                    </div>

                    <!-- Journal de progression -->
                    <div class="bg-black/60 p-2.5 rounded-xl border border-neutral-800 font-mono text-[11px] text-emerald-400 max-h-24 overflow-y-auto" id="ocr-debug-log">
                        [LOG] Prêt.
                    </div>

                    <!-- Résumé / Actions -->
                    <div class="flex flex-wrap items-center justify-between gap-3 bg-[#151515] p-3 rounded-xl border border-neutral-800">
                        <div class="flex items-center gap-2">
                            <span class="text-neutral-400 font-semibold">Matchs analysés : <b id="stats-sheets-count" class="text-white">0</b></span>
                            <span class="text-neutral-600">|</span>
                            <span class="text-neutral-400 font-semibold">Lignes identifiées : <b id="stats-players-count" class="text-white">0</b></span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="clearAllMatchSheets()" class="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950 text-neutral-400 hover:text-rose-300 border border-neutral-700 transition">
                                <i class="fa-solid fa-trash-can mr-1"></i> Tout effacer
                            </button>
                        </div>
                    </div>

                    <!-- Tableau consolidé -->
                    <div class="bg-[#151515] border border-neutral-800 rounded-xl overflow-hidden">
                        <div class="px-4 py-2.5 bg-[#202020] font-bold text-neutral-300 border-b border-neutral-800">Classement par Position de Ligne (Équipe Visiteurs)</div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="bg-[#191919] text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
                                        <th class="py-2.5 px-3">Poste / Ligne (Visiteurs)</th>
                                        <th class="py-2.5 px-2 text-center">Matchs</th>
                                        <th class="py-2.5 px-2 text-center">Pts Totaux</th>
                                        <th class="py-2.5 px-2 text-center text-orange-400">Moy. Pts / Match</th>
                                        <th class="py-2.5 px-2 text-center">Tirs Réussis</th>
                                    </tr>
                                </thead>
                                <tbody id="stats-table-body" class="divide-y divide-neutral-800/80 text-xs">
                                    <tr><td colspan="5" class="py-10 text-center text-neutral-500 italic">Aucune statistique enregistrée. Importez vos PDF ci-dessus.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="bg-[#252525] px-6 py-3 border-t border-neutral-700 flex justify-between items-center shrink-0">
                    <span class="text-[11px] text-neutral-400"><i class="fa-solid fa-circle-info mr-1 text-orange-400"></i> Extraction séquentielle des lignes.</span>
                    <button onclick="closeStatsModal()" class="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg text-xs transition">Fermer</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    renderStatsTable();
    modal.classList.remove('hidden');
}

function logOcrDebug(msg) {
    console.log("[OCR STATS]", msg);
    const logBox = document.getElementById('ocr-debug-log');
    if (logBox) {
        logBox.innerHTML += `<br>[${new Date().toLocaleTimeString()}] ${msg}`;
        logBox.scrollTop = logBox.scrollHeight;
    }
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
 * Analyse séquentielle : extrait chaque ligne de stats de la section VISITEURS par son index numérique (Ligne 1, Ligne 2...)
 */
async function parsePdfSheetWithOCR(pdfDoc, statusCallback) {
    let fullOcrText = "";
    const totalPages = pdfDoc.numPages;

    for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const imgDataUrl = canvas.toDataURL('image/png');

        if (statusCallback) statusCallback(`OCR page ${i}/${totalPages}...`);

        const { data: { text } } = await Tesseract.recognize(imgDataUrl, 'fra+eng');
        fullOcrText += `\n--- PAGE ${i} ---\n` + text;
    }

    let playerRows = [];

    // Isoler la partie VISITEURS
    const parts = fullOcrText.split(/VISITEURS/i);
    const targetText = parts.length > 1 ? parts[1] : fullOcrText;
    const lines = targetText.split('\n').map(l => l.trim()).filter(Boolean);

    let lineIndex = 1;
    lines.forEach(line => {
        if (/TOTAL|ENTRAINEUR|EQUIPE|MITEMPS|PROLONGATION|N°|MAILLOT/i.test(line)) return;

        // Cherche une ligne qui contient plusieurs nombres (correspondant aux colonnes de stats)
        const numbers = line.match(/\b\d+\b/g);
        if (numbers && numbers.length >= 3) {
            const validNumbers = numbers.map(Number).filter(n => n < 60);
            const pts = validNumbers.length > 0 ? validNumbers[validNumbers.length - 2] || validNumbers[0] : 0;
            const tirs = validNumbers.length > 1 ? validNumbers[validNumbers.length - 1] : 0;

            if (pts < 50) {
                playerRows.push({
                    nom: `Joueuse Ligne #${lineIndex}`,
                    pts: pts,
                    tirsReussis: tirs < 30 ? tirs : 0
                });
                logOcrDebug(`Ligne #${lineIndex} -> ${pts} pts`);
                lineIndex++;
            }
        }
    });

    return {
        players: playerRows
    };
}

async function handlePdfSheetsImportOCR(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const statusText = document.getElementById('ocr-status-text');
    let addedCount = 0;

    for (let file of files) {
        try {
            logOcrDebug(`Traitement : ${file.name}`);
            if (statusText) statusText.textContent = `Analyse de ${file.name}...`;
            
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdfDoc = await loadingTask.promise;

            const sheetData = await parsePdfSheetWithOCR(pdfDoc, (msg) => {
                if (statusText) statusText.textContent = `${file.name} : ${msg}`;
            });

            if (sheetData.players.length > 0) {
                loadedMatchSheets = loadedMatchSheets.filter(s => s.fileName !== file.name);
                loadedMatchSheets.push({
                    fileName: file.name,
                    importedAt: new Date().toISOString(),
                    ...sheetData
                });
                addedCount++;
                logOcrDebug(`Succès : ${sheetData.players.length} lignes extraites.`);
            } else {
                logOcrDebug(`Attention : Aucune ligne trouvée dans ${file.name}.`);
            }
        } catch (err) {
            logOcrDebug(`Erreur sur ${file.name} : ${err.message}`);
        }
    }

    if (statusText) statusText.textContent = `Import terminé (${addedCount} fichier(s) traité(s)).`;
    localStorage.setItem('espm_match_sheets_stats', JSON.stringify(loadedMatchSheets));
    event.target.value = '';
    renderStatsTable();
}

function getConsolidatedPlayerStats() {
    const statsMap = new Map();

    loadedMatchSheets.forEach(sheet => {
        sheet.players.forEach((p, idx) => {
            // On regroupe par position séquentielle (ex: "Joueuse Ligne #1")
            const key = `LIGNE_${idx + 1}`;

            if (!statsMap.has(key)) {
                statsMap.set(key, {
                    displayName: `Joueuse Ligne #${idx + 1}`,
                    matchsCount: 0,
                    ptsTotal: 0,
                    tirsTotal: 0
                });
            }

            const entry = statsMap.get(key);
            entry.matchsCount++;
            entry.ptsTotal += (p.pts || 0);
            entry.tirsTotal += (p.tirsReussis || 0);
        });
    });

    return Array.from(statsMap.values()).sort((a, b) => b.ptsTotal - a.ptsTotal);
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
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-neutral-500 italic">Aucune statistique enregistrée. Importez vos PDF ci-dessus.</td></tr>`;
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
            </tr>
        `;
    }).join('');
}