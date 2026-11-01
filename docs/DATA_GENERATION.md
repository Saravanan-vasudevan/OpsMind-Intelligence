# Demo data

`Data/DemoDataSeeder.cs` runs only when `Seed__DemoData=true` and the database has no organisations. Everything is **synthetic**: the organisation is named "Demo Manufacturing Ltd (synthetic data)".

Deterministic (`Random(42)`), 60 days ending today: 3 plants, 2 lines each, 4 machines per line, 3 shifts per plant.

Patterns deliberately built in so the dashboards have something to show — they are inputs I chose, not findings:
- South Plant Line 1 Machine 02 has increasing unplanned failures in the last 21 days.
- East Plant has a demand dip 35–42 days ago.
- North Plant reject rate is ×1.8 in the last 14 days.
- Wednesday planned maintenance; reduced weekend output; Machine 03 skips the night shift.

Because the patterns are planted, any detection of them in later versions is a test of the method, not evidence about real factories.

(Correction to the above: the seeder covers the 60 days **ending yesterday** — `firstDay = today − 60`, loop `day < today`.)

## V2: extra history and the import path

The forecasting and anomaly pages need more than 60 days (a 14-day forecast needs 56 days of history plus room to back-test). Rather than make the C# seeder bigger, V2 generates **more synthetic history as CSV files and imports them through the real upload path**, which also exercises the ETL:

```bash
cd services/intelligence
python tools/make_history_csv.py --out ../../data/demo        # the 120 days before the seeder's window; run on the day you seed
```

Upload `history_production.csv` and `history_downtime.csv` on the Data imports page (as the demo admin). `history_labels.csv` lists where the generator planted patterns (a machine with rising failures, a demand dip, a reject-rate rise); it is for checking the anomaly page against known answers and is **not** loaded anywhere.

`services/intelligence/opsmind_intel/synthetic.py` is a Python mirror of the C# seeder's structure and distributions (same plant, line, shift and asset codes — `NORTH`, `L1`, `N1-M01`, `Early/Late/Night` — so files import into a seeded organisation). The distributions are similar, **not bit-identical**, to the C# ones. The same generator drives the tests and the anomaly benchmark.

All of it is synthetic. Planted patterns are inputs I chose; detecting them tests the method, not any real plant.
