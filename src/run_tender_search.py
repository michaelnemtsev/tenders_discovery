from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict

from tender_discovery import build_routine_payload

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"


def save_payload(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Claude Australia Tender Discovery payload")
    parser.add_argument("--output", default=str(OUTPUT_DIR / "tenders.json"), help="Output JSON file path")
    args = parser.parse_args()

    payload = build_routine_payload()
    output_path = Path(args.output)
    save_payload(output_path, payload)

    print(f"Saved tender discovery payload to: {output_path}")
    print("Use this JSON or the prompt in prompts/deep_search_aus_tenders.txt with your Claude routine.")


if __name__ == "__main__":
    main()
