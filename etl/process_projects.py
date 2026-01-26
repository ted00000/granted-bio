"""
Process NIH RePORTER projects CSV file.
Applies bio-boundary filter and prepares data for classification.
"""

import csv
import os
from typing import Generator, Dict, Any, Optional
from datetime import datetime

# Bio-related activity codes (NIH institutes focused on life sciences)
BIO_ACTIVITY_CODES = {
    'R01', 'R21', 'R43', 'R44', 'R41', 'R42',  # Research grants
    'U01', 'U19', 'U54',  # Cooperative agreements
    'P01', 'P30', 'P50',  # Program/center grants
    'K01', 'K08', 'K23', 'K99',  # Career development
    'F31', 'F32',  # Fellowships
    'T32',  # Training grants
    'SBIR', 'STTR',  # Small business
}

# NIH Institutes focused on life sciences (bio boundary)
BIO_INSTITUTES = {
    'NIGMS', 'NCI', 'NHLBI', 'NIAID', 'NIDDK', 'NINDS', 'NIA', 'NICHD',
    'NEI', 'NIDCR', 'NIDCD', 'NIMH', 'NIDA', 'NIAAA', 'NINR', 'NHGRI',
    'NIBIB', 'NCATS', 'NIEHS', 'NIAMS', 'NCCIH', 'NLM', 'FIC', 'OD',
    'GM', 'CA', 'HL', 'AI', 'DK', 'NS', 'AG', 'HD', 'EY', 'DE', 'DC',
    'MH', 'DA', 'AA', 'NR', 'HG', 'EB', 'TR', 'ES', 'AR', 'AT',
}

# Keywords that indicate non-bio grants (to filter out)
NON_BIO_KEYWORDS = [
    'social determinants', 'health disparities', 'health policy',
    'healthcare delivery', 'health services research', 'epidemiology',
    'behavioral intervention', 'community health', 'public health',
]


def is_bio_related(row: Dict[str, Any]) -> bool:
    """
    Determine if a project is bio/life sciences related.
    Uses funding IC (institute/center) and activity code.
    """
    funding_ics = row.get('FUNDING_ICs', '') or ''
    activity = row.get('ACTIVITY', '') or ''
    title = (row.get('PROJECT_TITLE', '') or '').lower()
    phr = (row.get('PHR', '') or '').lower()

    # Check if any bio institute is funding
    has_bio_institute = any(inst in funding_ics.upper() for inst in BIO_INSTITUTES)

    # Check activity code
    has_bio_activity = activity.upper() in BIO_ACTIVITY_CODES

    # Check for non-bio keywords in title/PHR (exclude these)
    has_non_bio_keywords = any(kw in title or kw in phr for kw in NON_BIO_KEYWORDS)

    # Must have bio institute OR bio activity, and NOT have non-bio keywords
    return (has_bio_institute or has_bio_activity) and not has_non_bio_keywords


def parse_date(date_str: Optional[str]) -> Optional[str]:
    """Parse date string to ISO format."""
    if not date_str:
        return None
    try:
        # Try common formats
        for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%Y/%m/%d']:
            try:
                return datetime.strptime(date_str, fmt).strftime('%Y-%m-%d')
            except ValueError:
                continue
        return None
    except Exception:
        return None


def parse_cost(cost_str: Optional[str]) -> Optional[float]:
    """Parse cost string to float."""
    if not cost_str:
        return None
    try:
        # Remove commas and dollar signs
        clean = cost_str.replace(',', '').replace('$', '').strip()
        return float(clean) if clean else None
    except (ValueError, AttributeError):
        return None


def determine_org_type(org_name: str, funding_mechanism: str) -> str:
    """Determine organization type from name and funding mechanism."""
    org_name_lower = (org_name or '').lower()
    funding_lower = (funding_mechanism or '').lower()

    # SBIR/STTR indicates company
    if 'sbir' in funding_lower or 'sttr' in funding_lower:
        return 'company'

    # Check for company indicators
    company_indicators = ['inc', 'llc', 'corp', 'ltd', 'company', 'co.', 'technologies', 'therapeutics', 'biosciences', 'biotech']
    if any(ind in org_name_lower for ind in company_indicators):
        return 'company'

    # Check for university indicators
    university_indicators = ['university', 'college', 'institute of technology', 'school of']
    if any(ind in org_name_lower for ind in university_indicators):
        return 'university'

    # Check for hospital/medical center
    hospital_indicators = ['hospital', 'medical center', 'clinic', 'health system']
    if any(ind in org_name_lower for ind in hospital_indicators):
        return 'hospital'

    # Check for research institute
    research_indicators = ['research institute', 'research foundation', 'research center']
    if any(ind in org_name_lower for ind in research_indicators):
        return 'research_institute'

    return 'other'


def parse_supplement_info(full_project_num: Optional[str]) -> tuple[bool, Optional[str]]:
    """
    Extract supplement information from full project number.
    Supplements end with S followed by number (e.g., 3R01AG071228-05S1).

    Returns:
        (is_supplement, supplement_number) tuple
        e.g., (True, "S1") or (False, None)
    """
    import re
    if not full_project_num:
        return False, None

    match = re.search(r'S(\d+)$', full_project_num)
    if match:
        return True, f"S{match.group(1)}"
    return False, None


def process_projects_csv(filepath: str, limit: Optional[int] = None) -> Generator[Dict[str, Any], None, None]:
    """
    Process the NIH RePORTER projects CSV file.

    Args:
        filepath: Path to the CSV file
        limit: Optional limit on number of rows to process

    Yields:
        Processed project dictionaries ready for database insertion
    """
    count = 0
    bio_count = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            count += 1

            # Apply bio boundary filter
            if not is_bio_related(row):
                continue

            bio_count += 1

            # Extract and transform fields
            org_name = row.get('ORG_NAME', '')
            funding_mechanism = row.get('FUNDING_MECHANISM', '')
            full_project_num = row.get('FULL_PROJECT_NUM')

            # Parse supplement information
            is_supplement, supplement_number = parse_supplement_info(full_project_num)

            project = {
                'application_id': row.get('APPLICATION_ID'),
                'project_number': row.get('CORE_PROJECT_NUM'),
                'full_project_num': full_project_num,
                'activity_code': row.get('ACTIVITY'),
                'funding_mechanism': funding_mechanism,
                'title': row.get('PROJECT_TITLE'),
                'terms': row.get('PROJECT_TERMS'),
                'phr': row.get('PHR'),
                'org_name': org_name,
                'org_type': determine_org_type(org_name, funding_mechanism),
                'org_city': row.get('ORG_CITY'),
                'org_state': row.get('ORG_STATE'),
                'org_country': row.get('ORG_COUNTRY'),
                'org_zip': row.get('ORG_ZIPCODE'),
                'total_cost': parse_cost(row.get('TOTAL_COST')),
                'award_date': parse_date(row.get('AWARD_NOTICE_DATE')),
                'project_start': parse_date(row.get('PROJECT_START')),
                'project_end': parse_date(row.get('PROJECT_END')),
                'fiscal_year': int(row.get('FY', 0)) if row.get('FY') else None,
                'pi_names': row.get('PI_NAMEs'),
                'funding_agency': 'NIH',
                'is_bio_related': True,
                'is_supplement': is_supplement,
                'supplement_number': supplement_number,
            }

            yield project

            if limit and bio_count >= limit:
                break

    print(f"Processed {count} total rows, {bio_count} bio-related projects")


def load_projects(data_dir: str = 'data/raw', limit: Optional[int] = None) -> list:
    """
    Load and process all projects from the CSV file.

    NOTE: No deduplication is performed. Each APPLICATION_ID is unique and represents
    distinct funding (including supplements, multi-year phases, etc.).

    Args:
        data_dir: Directory containing the raw CSV files
        limit: Optional limit on number of projects to load

    Returns:
        List of processed project dictionaries
    """
    filepath = os.path.join(data_dir, 'RePORTER_PRJ_C_FY2025.csv')

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Projects file not found: {filepath}")

    projects = list(process_projects_csv(filepath, limit))
    print(f"Loaded {len(projects)} bio-related projects")

    # Count supplements for reporting
    supplement_count = sum(1 for p in projects if p.get('is_supplement'))
    print(f"  - Base grants: {len(projects) - supplement_count}")
    print(f"  - Supplements: {supplement_count}")

    return projects


if __name__ == '__main__':
    # Test with a small sample
    projects = load_projects(limit=100)

    # Print sample project
    if projects:
        print("\nSample project:")
        for key, value in projects[0].items():
            print(f"  {key}: {value[:100] if isinstance(value, str) and len(value) > 100 else value}")
