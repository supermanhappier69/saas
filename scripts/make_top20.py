"""Builds the simple TOP 20 IDEAS text file from the recovered idea details.

Source: morning-brief-recovery/top-20-ideas-recovered.txt (verbatim descriptions recovered
from the earlier chat). Truncated competitor lists are trimmed to the last complete entry.
Usage: python3 make_top20.py OUT_PATH [inbuild|final]
"""
import re
import sys

SRC = "/data/recovered/morning-brief-recovery/top-20-ideas-recovered.txt"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/data/project/docs/top-20-ideas.txt"
STATUS_MODE = sys.argv[2] if len(sys.argv) > 2 else "final"
BUILT = {1: "BUILT: working SaaS app 'PaidOnTime' (saas/products/latepay)",
         2: "BUILT: working SaaS app 'LetCheck' (saas/products/landlord)",
         3: "BUILT: working SaaS app 'SOPHub' (saas/products/sops)"}

text = open(SRC, encoding="utf-8").read()
blocks = re.split(r"\n(?=#\d+ )", text)
ideas = []
for b in blocks:
    lines = b.strip().splitlines()
    if not lines:
        continue
    m = re.match(r"#(\d+) (.+?) \| (\d+) \| (.+)", lines[0])
    if not m:
        continue
    n, name, score, kind = int(m.group(1)), m.group(2).strip(), int(m.group(3)), m.group(4).strip()
    fields = {}
    for line in lines[1:]:
        line = line.strip()
        if ":" in line:
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip()
    comp = fields.get("Competitor Pricing (verified)", "")
    parts = [p.strip() for p in comp.split(" / ") if p.strip()]
    clean = [p for p in parts if re.search(r"[.)]$", p)]
    if len(clean) < len(parts):
        clean.append("(rest of this list was cut off in the recovered record)")
    fields["Competitor Pricing (verified)"] = clean
    ideas.append((n, name, score, kind, fields))

ideas.sort(key=lambda x: (-x[2], x[0]))
W = 78
out = []
out.append("TOP 20 IDEAS READY TO LAUNCH")
out.append("=" * 28)
out.append("Opus Holdings - Research & Commercial Intelligence")
out.append("Ranked by OVERALL SCORE (out of 100) from the Market Opportunities database.")
out.append("Rebuilt 11 November 2026 from the recovered Sprint 1 record.")
out.append("")
out.append("HOW TO READ THIS")
out.append("- Score = pain (20) + demand evidence (20) + willingness to pay (15) +")
out.append("  differentiation (10) + build feasibility (10) + reaching buyers (10) +")
out.append("  recurring revenue (10) + scalability (5).")
out.append("- Prices are hypotheses. Competitor prices were checked in Sprint 1 and")
out.append("  have not been re-checked since.")
if STATUS_MODE == "final":
    out.append("- BUILT = a working SaaS app in this project bundle, with automated tests.")
else:
    out.append("- IN BUILD = being built as a working SaaS app in this project bundle.")
out.append("")
for i, (n, name, score, kind, f) in enumerate(ideas, 1):
    out.append("-" * W)
    out.append(f"#{i}  {name.upper()}")
    status = ""
    if n in BUILT:
        status = BUILT[n] if STATUS_MODE == "final" else "IN BUILD as a working SaaS app"
    out.append(f"    Score {score}/100 - {kind}" + (f" - {status}" if status else ""))
    out.append(f"    Who it's for: {f.get('Target Customer', '')}")
    out.append(f"    Problem:      {f.get('Specific Problem', '')}")
    out.append(f"    Solution:     {f.get('Proposed Solution', '')}")
    out.append(f"    Price idea:   {f.get('Potential Pricing (hypothesis)', '')}")
    comps = f.get("Competitor Pricing (verified)", [])
    if comps:
        out.append("    Competitors:")
        for c in comps:
            out.append(f"      - {c}")
out.append("-" * W)
out.append("")
out.append("Next step for every idea: talk to 5-10 real buyers before spending money.")
open(OUT, "w", encoding="utf-8").write("\n".join(out) + "\n")
print(f"wrote {OUT}: {len(ideas)} ideas")
