"""
Process NIH RePORTER publications CSV file.
Classifies journals as methods/therapeutic/computational.
"""

import csv
import os
import re
from datetime import datetime
from typing import Generator, Dict, Any, Optional, Set


def parse_pub_date(date_str: Optional[str]) -> Optional[str]:
    """
    Parse publication date string to ISO format.
    Handles formats like: "2025 Jul 22", "2025 May", "2025"
    """
    if not date_str:
        return None

    date_str = date_str.strip()

    # Try full date format: "2025 Jul 22"
    try:
        dt = datetime.strptime(date_str, "%Y %b %d")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        pass

    # Try month-year format: "2025 May"
    try:
        dt = datetime.strptime(date_str, "%Y %b")
        return dt.strftime("%Y-%m-01")
    except ValueError:
        pass

    # Try year only: "2025"
    if re.match(r'^\d{4}$', date_str):
        return f"{date_str}-01-01"

    # Try ISO format
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return date_str
    except ValueError:
        pass

    return None

# Methods journals (biotools indicator)
METHODS_JOURNALS = [
    'nat methods', 'nature methods',
    'nat protoc', 'nature protocols',
    'methods mol biol', 'methods in molecular biology',
    'curr protoc', 'current protocols',
    'jove', 'journal of visualized experiments',
    'elife',
    'sci rep', 'scientific reports',
    'methods',
    'star protoc', 'star protocols',
    'bmc bioinformatics',
    'bioinformatics',
    'nucleic acids res', 'nucleic acids research',
    'genome biol', 'genome biology',
    'plos comput biol', 'plos computational biology',
    'anal chem', 'analytical chemistry',
    'lab chip',
    'biosens bioelectron', 'biosensors and bioelectronics',
]

# Therapeutic journals (anti-biotools indicator)
THERAPEUTIC_JOURNALS = [
    'n engl j med', 'new england journal of medicine',
    'jama',
    'lancet',
    'cell',
    'nature med', 'nature medicine',
    'cancer cell',
    'blood',
    'neuron',
    'immunity',
    'mol ther', 'molecular therapy',
    'j clin oncol', 'journal of clinical oncology',
    'j clin invest', 'journal of clinical investigation',
    'circulation',
    'gastroenterology',
    'hepatology',
    'diabetes',
    'ann intern med', 'annals of internal medicine',
]

# Computational journals
COMPUTATIONAL_JOURNALS = [
    'bioinformatics',
    'plos comput biol', 'plos computational biology',
    'bmc bioinformatics',
    'genome res', 'genome research',
    'nucleic acids res', 'nucleic acids research',
    'nat biotechnol', 'nature biotechnology',
    'briefings in bioinformatics',
    'j comput biol', 'journal of computational biology',
]


def classify_journal(journal_abbr: str, journal_title: str) -> Dict[str, bool]:
    """
    Classify a journal based on its abbreviation and title.

    Returns dict with is_methods_journal, is_therapeutic_journal, is_computational_journal
    """
    journal_lower = (journal_abbr or '').lower()
    title_lower = (journal_title or '').lower()

    combined = f"{journal_lower} {title_lower}"

    return {
        'is_methods_journal': any(mj in combined for mj in METHODS_JOURNALS),
        'is_therapeutic_journal': any(tj in combined for tj in THERAPEUTIC_JOURNALS),
        'is_computational_journal': any(cj in combined for cj in COMPUTATIONAL_JOURNALS),
    }


def process_publications_csv(filepath: str, limit: Optional[int] = None) -> Generator[Dict[str, Any], None, None]:
    """
    Process the NIH RePORTER publications CSV file.

    Args:
        filepath: Path to the CSV file
        limit: Optional limit on number of rows to process

    Yields:
        Processed publication dictionaries ready for database insertion
    """
    count = 0
    seen_pmids: Set[str] = set()

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            count += 1

            pmid = row.get('PMID')
            if not pmid or pmid in seen_pmids:
                continue

            seen_pmids.add(pmid)

            journal_abbr = row.get('JOURNAL_TITLE_ABBR', '')
            journal_title = row.get('JOURNAL_TITLE', '')

            # Classify journal
            classification = classify_journal(journal_abbr, journal_title)

            # Parse pub_year
            pub_year = None
            try:
                pub_year = int(row.get('PUB_YEAR', 0)) if row.get('PUB_YEAR') else None
            except ValueError:
                pass

            publication = {
                'pmid': pmid,
                'pub_title': row.get('PUB_TITLE'),
                'journal_title': journal_title,
                'journal_abbr': journal_abbr,
                'pub_year': pub_year,
                'pub_date': parse_pub_date(row.get('PUB_DATE')),
                'author_list': row.get('AUTHOR_LIST'),
                'affiliation': row.get('AFFILIATION'),
                'pmc_id': row.get('PMC_ID'),
                'issn': row.get('ISSN'),
                **classification,
            }

            yield publication

            if limit and len(seen_pmids) >= limit:
                break

    print(f"Processed {count} rows, {len(seen_pmids)} unique publications")


def process_publication_links_csv(filepath: str) -> Dict[str, list]:
    """
    Process the publication links CSV to map projects to PMIDs.

    Returns dict mapping project_number -> list of PMIDs
    """
    project_pubs: Dict[str, list] = {}

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            pmid = row.get('PMID')
            project_num = row.get('PROJECT_NUMBER')

            if pmid and project_num:
                if project_num not in project_pubs:
                    project_pubs[project_num] = []
                project_pubs[project_num].append(pmid)

    print(f"Loaded publication links for {len(project_pubs)} projects")
    return project_pubs


def load_publications(data_dir: str = 'data/raw', limit: Optional[int] = None) -> tuple:
    """
    Load and process publications and their links.

    Returns:
        Tuple of (publications_list, project_to_pmids_dict)
    """
    pubs_filepath = os.path.join(data_dir, 'RePORTER_PUB_C_FY2025.csv')
    links_filepath = os.path.join(data_dir, 'RePORTER_PUBLNK_C_FY2025.csv')

    if not os.path.exists(pubs_filepath):
        raise FileNotFoundError(f"Publications file not found: {pubs_filepath}")

    publications = list(process_publications_csv(pubs_filepath, limit))

    # Load links if available
    project_pubs = {}
    if os.path.exists(links_filepath):
        project_pubs = process_publication_links_csv(links_filepath)

    return publications, project_pubs


if __name__ == '__main__':
    # Test with a small sample
    publications, project_pubs = load_publications(limit=1000)

    # Count journal classifications
    methods_count = sum(1 for p in publications if p['is_methods_journal'])
    therapeutic_count = sum(1 for p in publications if p['is_therapeutic_journal'])

    print(f"\nJournal classification:")
    print(f"  Methods journals: {methods_count}")
    print(f"  Therapeutic journals: {therapeutic_count}")

    # Print sample publication
    if publications:
        print("\nSample publication:")
        for key, value in publications[0].items():
            print(f"  {key}: {value}")
