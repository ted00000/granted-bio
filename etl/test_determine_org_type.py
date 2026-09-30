#!/usr/bin/env python3
"""Regression tests for determine_org_type in process_projects.py.

Standalone assertion-based tests (project doesn't use pytest). Run with:
  python3 etl/test_determine_org_type.py

Every test case names the historical failure it protects against, so a
future reader can tell which value pattern the test is defending. If
this ever fails, the fix is in etl/process_projects.py — do NOT silence
the test by removing cases.
"""

import sys
from process_projects import determine_org_type


CASES = [
    # (org_name, funding_mechanism, expected, why)

    # === The bug that motivated the test suite ===
    # RePORTER API v2 returns funding_mechanism='Non-SBIR/STTR' for
    # every regular R-series grant. A naive substring check
    # `'sbir' in 'non-sbir/sttr'` returns True. Before this fix,
    # 30K+ university/hospital/research-institute projects were
    # misclassified as company because their funding_mechanism was
    # 'Non-SBIR/STTR'. These cases guard the exact failure.
    ('UNIVERSITY OF CALIFORNIA, SAN FRANCISCO', 'Non-SBIR/STTR', 'university',
     'RePORTER v2 Non-SBIR/STTR must not trigger company classification'),
    ('UNIVERSITY OF MINNESOTA', 'Non-SBIR/STTR', 'university',
     'RePORTER v2 Non-SBIR/STTR must not trigger company classification'),
    ('BOSTON CHILDRENS HOSPITAL', 'Non-SBIR/STTR', 'hospital',
     'RePORTER v2 Non-SBIR/STTR at a hospital must classify as hospital'),
    ('YALE UNIVERSITY', 'Non-SBIR/STTR', 'university',
     'RePORTER v2 Non-SBIR/STTR at a university must classify as university'),
    ('COLUMBIA UNIVERSITY HEALTH SCIENCES', 'Non-SBIR/STTR', 'university',
     'RePORTER v2 Non-SBIR/STTR — university wins over health'),
    ('NEW YORK STATE PSYCHIATRIC INSTITUTE DBA RESEARCH FOUNDATION FOR MENTAL HYGIENE, INC',
     'Non-SBIR/STTR', 'research_institute',
     'Research foundation wins over "inc" suffix'),

    # === Word-boundary bugs ===
    # "prINCeton" contains the "inc" substring but Princeton is not a
    # company. Same class: substring hits on multi-syllable words.
    ('PRINCETON UNIVERSITY', 'Non-SBIR/STTR', 'university',
     'Princeton must not match "inc" as substring of "prINCeton"'),
    ('PRINCETON UNIVERSITY', 'RESEARCH GRANTS', 'university',
     'Princeton must not match "inc" as substring even under any mechanism'),

    # === Genuine companies must still classify correctly ===
    ('SYNTIS BIO INC', 'SBIR', 'company',
     'Standalone "Inc" as word — company'),
    ('SYNTIS BIO INC', 'Non-SBIR/STTR', 'company',
     '"Inc" name wins even when mechanism is Non-SBIR/STTR'),
    ('PRECISION QUANTOMICS INC', 'Non-SBIR/STTR', 'company',
     'Another "Inc" — company via name'),
    ('MODERNA THERAPEUTICS', 'RESEARCH GRANTS', 'company',
     '"Therapeutics" as word — company'),
    ('SOMA BIOTECHNOLOGIES LLC', '', 'company',
     '"LLC" as word — company'),
    ('ACME CORP', '', 'company',
     '"Corp" as word — company'),
    ('SMALL BUSINESS CO.', '', 'company',
     '"Co." abbreviation — company'),

    # === SBIR/STTR mechanism triggers company only when name is generic ===
    ('SMITHVILLE RESEARCH LABS', 'SBIR-STTR', 'company',
     'SBIR-STTR mechanism at generic-name org falls through to company'),
    ('BLACKBIRD SOLUTIONS', 'STTR', 'company',
     'STTR mechanism at generic-name org falls through to company'),

    # === Hospital / research institute / university indicators ===
    ('MASSACHUSETTS GENERAL HOSPITAL', '', 'hospital',
     '"Hospital" as word — hospital'),
    ('MAYO CLINIC', 'RESEARCH GRANTS', 'hospital',
     '"Clinic" as word — hospital'),
    ('CEDARS-SINAI MEDICAL CENTER', '', 'hospital',
     '"Medical center" phrase — hospital'),
    ('MASSACHUSETTS INSTITUTE OF TECHNOLOGY', '', 'university',
     '"Institute of technology" phrase — university'),
    ('SCRIPPS RESEARCH INSTITUTE', '', 'research_institute',
     '"Research institute" phrase — research_institute'),
    ('SALK INSTITUTE', '', 'other',
     'Bare "Institute" without a research-* prefix is not classified'),

    # === Empty / None inputs must not crash ===
    ('', '', 'other', 'Empty inputs → other'),
    (None, None, 'other', 'None inputs → other'),
    (None, 'SBIR', 'company', 'None name but real SBIR mechanism → company'),

    # === "co." must be an abbreviation, not any occurrence of "co" ===
    ('SAN FRANCISCO HEALTH CO-OP', '', 'other',
     '"co-op" must not trigger company classification'),
]


def run() -> int:
    fails = 0
    for name, fm, expected, why in CASES:
        try:
            got = determine_org_type(name, fm)
        except Exception as e:
            print(f'FAIL crash: determine_org_type({name!r}, {fm!r}) raised {e}')
            fails += 1
            continue
        if got != expected:
            print(f'FAIL: determine_org_type({name!r}, {fm!r}) → {got!r}, expected {expected!r}')
            print(f'  ({why})')
            fails += 1
    if fails == 0:
        print(f'OK — all {len(CASES)} cases pass')
        return 0
    print(f'\n{fails} of {len(CASES)} cases FAILED')
    return 1


if __name__ == '__main__':
    sys.exit(run())
