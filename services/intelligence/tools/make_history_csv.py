"""Write import-ready SYNTHETIC history files for the demo.

The C# demo seeder creates the last 60 days (ending yesterday). This tool writes the 120 days before that, so the
forecasting and anomaly pages have ~6 months of history. Run it on the same day you seed.

    python tools/make_history_csv.py --out data/demo          # relative to today
    python tools/make_history_csv.py --out data/demo --seed-start 2026-08-28

Outputs: history_production.csv, history_downtime.csv and history_labels.csv (where patterns were planted).
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from opsmind_intel.synthetic import default_patterns, generate  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("data/demo"))
    parser.add_argument("--days", type=int, default=120)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--seed-start", type=date.fromisoformat, default=None,
                        help="first day covered by the C# seeder (default: 60 days before today, UTC)")
    args = parser.parse_args()

    seeder_start = args.seed_start or (datetime.now(timezone.utc).date() - timedelta(days=60))
    start = seeder_start - timedelta(days=args.days)
    end = seeder_start - timedelta(days=1)
    result = generate(start, args.days, seed=args.seed, patterns=default_patterns(end))

    args.out.mkdir(parents=True, exist_ok=True)
    result.production.to_csv(args.out / "history_production.csv", index=False)
    result.downtime.to_csv(args.out / "history_downtime.csv", index=False)
    result.labels.to_csv(args.out / "history_labels.csv", index=False)
    print(f"Synthetic history {start} .. {end}: {len(result.production)} production rows, {len(result.downtime)} downtime rows -> {args.out}")


if __name__ == "__main__":
    main()
