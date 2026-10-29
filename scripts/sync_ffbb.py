#!/usr/bin/env python3
"""
Synchronisation officielle FFBB pour ES PENNES MIRABEAU (SUD0013043 - 13170 - ID: 12180)
Génère data/ffbb-matches.json pour GitHub Pages.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from ffbb_data_client import FFBBDataClient

CLUB_CODE = "SUD0013043"
CLUB_ID = "12180"
OUTPUT_PATH = Path("data/ffbb-matches.json")


def get_attr(obj, *keys, default=None):
    if obj is None:
        return default
    for k in keys:
        if isinstance(obj, dict) and k in obj and obj[k] is not None:
            return obj[k]
        val = getattr(obj, k, None)
        if val is not None:
            return val
    return default


def normalize_date_and_time(raw_date, raw_time):
    date_str = None
    time_str = None

    if raw_date:
        s = str(raw_date).strip()
        m_iso = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?", s)
        if m_iso:
            date_str = m_iso.group(1)
            if m_iso.group(2) and m_iso.group(2) != "00:00":
                time_str = m_iso.group(2)
        else:
            m_fr = re.match(r"^(\d{2})/(\d{2})/(\d{4})", s)
            if m_fr:
                date_str = f"{m_fr.group(3)}-{m_fr.group(2)}-{m_fr.group(1)}"

    if raw_time:
        t = str(raw_time).strip().lower().replace("h", ":")
        m_t = re.search(r"(\d{1,2}):(\d{2})", t)
        if m_t:
            time_str = f"{int(m_t.group(1)):02d}:{m_t.group(2)}"
        elif re.match(r"^\d{4}$", t):
            time_str = f"{t[:2]}:{t[2:]}"

    return date_str, (time_str or "15:00")


def is_espm_team(nom_equipe: str, id_org: str) -> bool:
    if id_org and str(id_org) == str(CLUB_ID):
        return True
    if not nom_equipe:
        return False
    upper = nom_equipe.upper()
    return "PENNES" in upper or CLUB_CODE in upper


def build_team_key(competition_label: str, our_team_name: str) -> str:
    comp = (competition_label or "").upper()
    name = (our_team_name or "").upper()
    team_num = ""
    m_num = re.search(r"(?:-\s*|\(|\b)([1234])(?:\)|\b)\s*$", name)
    if m_num:
        team_num = f" ({m_num.group(1)})"

    if comp:
        return f"{competition_label.strip()}{team_num}"
    return our_team_name.strip() or "Équipe ESPM"


def main():
    print(f"Connexion à l'API FFBB via ffbb-data-client...")
    client = FFBBDataClient.create()

    raw_matches_by_id = {}

    # Recherche large par mots-clés dans l'index Meilisearch des rencontres
    keywords = ["PENNES", "MIRABEAU", "SUD0013043"]
    for kw in keywords:
        try:
            print(f"Recherche Meilisearch : '{kw}'...")
            res = client.search_rencontres(kw, limit=500)
            hits = get_attr(res, "hits", default=[]) or []
            print(f" -> {len(hits)} résultats trouvés pour '{kw}'")
            for m in hits:
                m_id = str(get_attr(m, "id", "numero", default=""))
                if m_id:
                    raw_matches_by_id[m_id] = m
        except Exception as e:
            print(f"Erreur lors de la recherche pour '{kw}': {e}")

    print(f"Total des rencontres brutes collectées : {len(raw_matches_by_id)}")

    normalized_matches = []
    teams_registry = {}

    for m_id, r in raw_matches_by_id.items():
        eq1 = str(get_attr(r, "equipe1", "nomEquipe1", "nom_equipe_1", default="")).strip()
        eq2 = str(get_attr(r, "equipe2", "nomEquipe2", "nom_equipe_2", default="")).strip()

        org1 = get_attr(r, "id_organisme_equipe1", "idOrganismeEquipe1", default="")
        org2 = get_attr(r, "id_organisme_equipe2", "idOrganismeEquipe2", default="")
        if isinstance(org1, dict): org1 = org1.get("id", "")
        if isinstance(org2, dict): org2 = org2.get("id", "")

        home_is_espm = is_espm_team(eq1, str(org1))
        away_is_espm = is_espm_team(eq2, str(org2))

        if not home_is_espm and not away_is_espm:
            continue

        raw_date = get_attr(r, "date_rencontre", "dateRencontre", "date")
        raw_time = get_attr(r, "horaire", "heure")
        date_str, time_str = normalize_date_and_time(raw_date, raw_time)
        if not date_str:
            continue

        comp_name = (
            get_attr(r, "competition_nom", "competitionNom", "division", "categorie", "poule_nom")
            or "Championnat FFBB"
        )

        our_team_raw = eq1 if home_is_espm else eq2
        opponent_raw = eq2 if home_is_espm else eq1
        team_label = build_team_key(str(comp_name), our_team_raw)
        team_id = re.sub(r"[^a-zA-Z0-9]+", "_", team_label).strip("_").upper()

        teams_registry[team_id] = {
            "id": team_id,
            "label": team_label,
            "competition": str(comp_name),
            "officialTeamName": our_team_raw,
        }

        salle_nom = (
            get_attr(r, "salle_nom", "salleNom")
            or ("Gymnase des Pennes-Mirabeau" if home_is_espm else f"Extérieur ({opponent_raw})")
        )

        numero = str(get_attr(r, "numero", "code", "id", default=m_id))
        s1 = get_attr(r, "resultat_equipe1", "resultatEquipe1")
        s2 = get_attr(r, "resultat_equipe2", "resultatEquipe2")
        joue = bool(get_attr(r, "joue", default=False) or (s1 is not None and s2 is not None))

        normalized_matches.append({
            "id": str(m_id),
            "numero": numero,
            "date": date_str,
            "horaire": time_str,
            "teamId": team_id,
            "teamLabel": team_label,
            "competition": str(comp_name),
            "isHome": bool(home_is_espm),
            "equipe1": eq1,
            "equipe2": eq2,
            "opponent": opponent_raw,
            "salle": str(salle_nom),
            "joue": joue,
            "score1": s1,
            "score2": s2,
        })

    normalized_matches.sort(key=lambda x: (x["date"], x["horaire"]))

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "club": {
            "id": CLUB_ID,
            "code": CLUB_CODE,
            "nom": "ES PENNES MIRABEAU",
            "codePostal": "13170",
            "commune": "LES PENNES-MIRABEAU",
        },
        "teams": list(teams_registry.values()),
        "matches": normalized_matches,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Terminé : {len(normalized_matches)} rencontres officielles et {len(teams_registry)} équipes enregistrées dans {OUTPUT_PATH}")


if __name__ == "__main__":
    main()