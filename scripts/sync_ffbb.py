#!/usr/bin/env python3
"""
Synchronisation exhaustive de la saison FFBB pour ES PENNES MIRABEAU (ID: 12180)
Utilise le SDK ffbb-data-client avec conversion Pydantic propre.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from ffbb_data_client import FFBBDataClient

CLUB_ID = 12180
CLUB_CODE = "SUD0013043"
OUTPUT_PATH = Path("data/ffbb-matches.json")

FR_MONTHS = {
    "janvier": "01", "février": "02", "fevrier": "02", "mars": "03",
    "avril": "04", "mai": "05", "juin": "06", "juillet": "07",
    "août": "08", "aout": "08", "septembre": "09", "octobre": "10",
    "novembre": "11", "décembre": "12", "decembre": "12",
}


def normalize_date_and_time(raw_date, raw_time):
    date_str = None
    time_str = "15:00"

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
            else:
                m_txt = re.search(r"(\d{1,2})\s+([a-zA-ZéûÉÛ]+)\s+(\d{4})", s)
                if m_txt:
                    day = f"{int(m_txt.group(1)):02d}"
                    month = FR_MONTHS.get(m_txt.group(2).lower())
                    year = m_txt.group(3)
                    if month:
                        date_str = f"{year}-{month}-{day}"

    if raw_time:
        t = str(raw_time).strip().lower().replace("h", ":")
        m_t = re.search(r"(\d{1,2}):(\d{2})", t)
        if m_t:
            time_str = f"{int(m_t.group(1)):02d}:{m_t.group(2)}"

    return date_str, time_str


def slugify_id(label: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", (label or "EQUIPE")).strip("_").upper()


def to_dict(obj):
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_dict(item) for item in obj]
    if hasattr(obj, "model_dump"):
        return to_dict(obj.model_dump())
    if hasattr(obj, "dict"):
        return to_dict(obj.dict())
    if hasattr(obj, "__dict__"):
        return to_dict(vars(obj))
    return str(obj)


def unwrap_list(payload):
    payload = to_dict(payload)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("matches", "teams", "items", "data", "results", "rencontres", "equipes", "hits", "calendrier", "poule"):
            val = payload.get(k)
            if isinstance(val, list):
                return val
            if isinstance(val, dict):
                sub = unwrap_list(val)
                if sub:
                    return sub
    return []


def main():
    print("Initialisation de FFBBDataClient...")
    client = FFBBDataClient.create()

    try:
        org = to_dict(client.get_organisme(organisme_id=CLUB_ID))
    except Exception:
        org = to_dict(client.get_organisme(id=CLUB_ID))

    club_nom = org.get("nom", "ES PENNES MIRABEAU")
    commune_obj = org.get("commune", "LES PENNES-MIRABEAU")
    club_commune = commune_obj.get("libelle", "LES PENNES-MIRABEAU") if isinstance(commune_obj, dict) else str(commune_obj)

    engagements = unwrap_list(org.get("engagements") or org.get("teams") or [])
    print(f"-> Club : {club_nom} | {len(engagements)} engagement(s) trouvé(s)")

    teams_registry = {}
    poule_to_team = {}

    for eng in engagements:
        if not isinstance(eng, dict):
            continue
        
        p_obj = eng.get("idPoule") or eng.get("id_poule") or eng.get("poule_id")
        poule_id = ""
        if isinstance(p_obj, dict):
            poule_id = str(p_obj.get("id") or "")
        elif p_obj is not None:
            poule_id = str(p_obj)

        comp = str(eng.get("competition") or eng.get("nom") or "Championnat FFBB").strip()
        t_num = str(eng.get("team_number") or eng.get("numero") or "").strip()

        label = f"{comp} (Éq. {t_num})" if t_num else comp
        tid = slugify_id(label)

        team_info = {
            "id": tid,
            "label": label,
            "competition": comp,
            "officialTeamName": f"ES PENNES MIRABEAU - {t_num}" if t_num else "ES PENNES MIRABEAU",
        }
        teams_registry[tid] = team_info
        if poule_id:
            poule_to_team[poule_id] = team_info

    print(f"Interrogation de {len(poule_to_team)} poule(s) via le SDK...")

    matches_by_id = {}

    for pid in poule_to_team.keys():
        try:
            poule_res = to_dict(client.get_poule(int(pid) if pid.isdigit() else pid))
            # Recherche récursive de listes de matchs/rencontres dans la réponse de la poule
            def find_matches(node):
                found = []
                if isinstance(node, list):
                    for item in node:
                        found.extend(find_matches(item))
                elif isinstance(node, dict):
                    # Si le dict ressemble à un match (contient date ou id de match)
                    if "equipe1" in node or "nomEquipe1" in node or "date" in node or "dateISO" in node:
                        found.append(node)
                    for v in node.values():
                        found.extend(find_matches(v))
                return found

            rencontres = find_matches(poule_res)
            team_info = poule_to_team.get(pid)

            for r in rencontres:
                if not isinstance(r, dict):
                    continue
                mid = str(r.get("id") or r.get("ffbbMatchId") or r.get("numero") or "")
                if mid:
                    r["_team_info"] = team_info
                    matches_by_id[mid] = r
        except Exception as e:
            print(f"   Avertissement poule {pid}: {e}")

    print(f"-> Total de {len(matches_by_id)} rencontre(s) collectée(s)")

    normalized_matches = []
    for mid, m in matches_by_id.items():
        raw_date = m.get("dateISO") or m.get("date_rencontre") or m.get("dateRencontre") or m.get("date")
        raw_time = m.get("time") or m.get("horaire") or m.get("heure")
        date_str, time_str = normalize_date_and_time(raw_date, raw_time)
        if not date_str:
            continue

        eq1 = str(m.get("equipe1") or m.get("nomEquipe1") or m.get("team") or "").strip()
        eq2 = str(m.get("equipe2") or m.get("nomEquipe2") or m.get("opponent") or "").strip()

        home_is_espm = CLUB_CODE in eq1.upper() or "PENNES" in eq1.upper()
        away_is_espm = CLUB_CODE in eq2.upper() or "PENNES" in eq2.upper()

        team_info = m.get("_team_info")
        if not home_is_espm and not away_is_espm and not team_info:
            continue

        is_home = "PENNES" in eq1.upper() or CLUB_CODE in eq1.upper() or (team_info is not None)
        our_team = eq1 if is_home else eq2
        opponent = eq2 if is_home else eq1
        if not our_team:
            our_team = "ES PENNES MIRABEAU"
        if not opponent:
            opponent = "Adversaire"

        salle_str = str(
            m.get("location") or m.get("salle") or m.get("salle_nom") or
            ("Gymnase des Pennes-Mirabeau" if is_home else f"Extérieur ({opponent})")
        )

        if team_info:
            team_id = team_info["id"]
            team_label = team_info["label"]
            comp_name = team_info["competition"]
        else:
            comp_name = str(m.get("competition") or "Championnat FFBB")
            team_label = comp_name
            team_id = slugify_id(comp_name)
            if team_id not in teams_registry:
                teams_registry[team_id] = {
                    "id": team_id,
                    "label": team_label,
                    "competition": comp_name,
                    "officialTeamName": our_team,
                }

        s1 = m.get("scoreLocal") if m.get("scoreLocal") is not None else m.get("resultat_equipe1")
        s2 = m.get("scoreVisitor") if m.get("scoreVisitor") is not None else m.get("resultat_equipe2")
        joue = bool(m.get("isPlayed") or m.get("joue") or (s1 is not None and s2 is not None))

        normalized_matches.append({
            "id": str(mid),
            "numero": str(m.get("numero") or m.get("ffbbMatchId") or mid),
            "date": date_str,
            "horaire": time_str,
            "teamId": team_id,
            "teamLabel": team_label,
            "competition": comp_name,
            "isHome": is_home,
            "equipe1": eq1 or our_team,
            "equipe2": eq2 or opponent,
            "opponent": opponent,
            "salle": salle_str,
            "joue": joue,
            "score1": s1,
            "score2": s2,
        })

    normalized_matches.sort(key=lambda x: (x["date"], x["horaire"]))

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "club": {
            "id": str(CLUB_ID),
            "code": CLUB_CODE,
            "nom": club_nom,
            "codePostal": "13170",
            "commune": club_commune,
        },
        "teams": list(teams_registry.values()),
        "matches": normalized_matches,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Succès : {len(normalized_matches)} rencontres et {len(teams_registry)} équipes écrites dans {OUTPUT_PATH}")


if __name__ == "__main__":
    main()