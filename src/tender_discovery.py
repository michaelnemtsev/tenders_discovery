from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

OFFICIAL_TENDER_PORTALS: List[Dict[str, str]] = [
    {
        "jurisdiction": "Commonwealth",
        "state": "Australia",
        "name": "AusTender",
        "url": "https://www.tenders.gov.au",
        "description": "Australian Government procurement and tender notices.",
    },
    {
        "jurisdiction": "New South Wales",
        "state": "NSW",
        "name": "eTendering NSW",
        "url": "https://www.tenders.nsw.gov.au",
        "description": "New South Wales government tenders and contracts.",
    },
    {
        "jurisdiction": "Victoria",
        "state": "VIC",
        "name": "Victorian Government Tenders",
        "url": "https://www.tenders.vic.gov.au",
        "description": "Victorian government procurement and tender listings.",
    },
    {
        "jurisdiction": "Queensland",
        "state": "QLD",
        "name": "QTenders / Queensland Government",
        "url": "https://www.hpw.qld.gov.au",
        "description": "Queensland government tenders and procurement notices.",
    },
    {
        "jurisdiction": "Western Australia",
        "state": "WA",
        "name": "WA Tenders",
        "url": "https://www.tenders.wa.gov.au",
        "description": "Western Australian government tenders and quotes.",
    },
    {
        "jurisdiction": "South Australia",
        "state": "SA",
        "name": "SA Tenders",
        "url": "https://www.tenders.sa.gov.au",
        "description": "South Australian government procurement notices.",
    },
    {
        "jurisdiction": "Tasmania",
        "state": "TAS",
        "name": "Tasmania Tenders",
        "url": "https://www.tenders.tas.gov.au",
        "description": "Tasmanian government tender opportunities and contracts.",
    },
    {
        "jurisdiction": "Northern Territory",
        "state": "NT",
        "name": "NT Government Tenders",
        "url": "https://www.tenders.nt.gov.au",
        "description": "Northern Territory government tenders and procurement notices.",
    },
    {
        "jurisdiction": "Australian Capital Territory",
        "state": "ACT",
        "name": "ACT Government Tenders",
        "url": "https://www.tenders.act.gov.au",
        "description": "ACT government procurement and tender listings.",
    },
]


def get_official_portal_sources() -> List[Dict[str, str]]:
    """Return the list of official Australian government tender portals."""
    return OFFICIAL_TENDER_PORTALS.copy()


def build_claude_search_prompt() -> str:
    """Load the comprehensive prompt for the Claude tender discovery routine."""
    prompt_path = Path(__file__).resolve().parent.parent / "prompts" / "deep_search_aus_tenders.txt"
    return prompt_path.read_text(encoding="utf-8")


def build_routine_payload() -> Dict[str, Any]:
    """Prepare the payload for a Claude routine or workflow."""
    return {
        "sources": get_official_portal_sources(),
        "prompt": build_claude_search_prompt(),
    }


def main() -> None:
    payload = build_routine_payload()
    print("=== Official Tender Sources ===")
    for source in payload["sources"]:
        print(f"- {source['jurisdiction']} / {source['name']}: {source['url']}")

    print("\n=== Claude Search Prompt ===")
    print(payload["prompt"])


if __name__ == "__main__":
    main()
