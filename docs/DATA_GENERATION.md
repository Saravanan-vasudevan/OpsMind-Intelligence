# Demo data

`Data/DemoDataSeeder.cs` runs only when `Seed__DemoData=true` and the database has no organisations. Everything is **synthetic**: the organisation is named "Demo Manufacturing Ltd (synthetic data)".

Deterministic (`Random(42)`), 60 days ending today: 3 plants, 2 lines each, 4 machines per line, 3 shifts per plant.

Patterns deliberately built in so the dashboards have something to show — they are inputs I chose, not findings:
- South Plant Line 1 Machine 02 has increasing unplanned failures in the last 21 days.
- East Plant has a demand dip 35–42 days ago.
- North Plant reject rate is ×1.8 in the last 14 days.
- Wednesday planned maintenance; reduced weekend output; Machine 03 skips the night shift.

Because the patterns are planted, any detection of them in later versions is a test of the method, not evidence about real factories.
