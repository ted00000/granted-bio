"""
Multi-Tier Biotools Classification Algorithm.
Implements the 5-tier weighted scoring system from 03_CLASSIFICATION_ALGORITHM.md
"""

from typing import Dict, Any, List, Optional, Tuple

# ============================================================================
# TIER 1: Core Signals (Projects Table)
# Weight Range: -15 to +55 points
# ============================================================================

TIER1_PHR_DEVELOPER_PHRASES = [
    'prototype', 'instrument', 'commercial', 'platform',
    'benchtop', 'device', 'enable researchers to',
    'commercial-ready', 'automation', 'user-friendly',
    'market', 'fda', 'regulatory', 'kit', 'assay',
]

TIER1_PHR_USER_PHRASES = [
    'using to study', 'applying', 'dissecting', 'investigating',
    'employing', 'utilize', 'leverage existing', 'we will use',
]

TIER1_TITLE_DEVELOPER_PATTERNS = [
    'platform for', 'tool for', 'method for', 'device for',
    'system for', 'assay for', 'instrument for',
    'development of', 'novel approach to', 'kit for',
]


def apply_tier_1(project: Dict[str, Any], score: float, signals: List[Dict]) -> Tuple[float, List[Dict]]:
    """
    Apply Tier 1: Core Signals from projects table.
    """
    funding_mechanism = (project.get('funding_mechanism') or '').upper()
    org_type = (project.get('org_type') or '').lower()
    phr = (project.get('phr') or '').lower()
    title = (project.get('title') or '').lower()

    # Signal 1.1: SBIR/STTR Funding (+30 points)
    if 'SBIR' in funding_mechanism or 'STTR' in funding_mechanism:
        score += 30
        signals.append({
            'tier': 1,
            'source': 'funding_mechanism',
            'signal': 'SBIR/STTR funding',
            'weight': 30,
            'reasoning': 'SBIR indicates commercialization intent'
        })

    # Signal 1.2: Company Organization Type (+10 points)
    if org_type in ['company', 'small business']:
        score += 10
        signals.append({
            'tier': 1,
            'source': 'org_type',
            'signal': f'Organization type: {org_type}',
            'weight': 10,
            'reasoning': 'Companies more likely to commercialize tools'
        })

    # Signal 1.3: PHR Developer Language (+15 points)
    for phrase in TIER1_PHR_DEVELOPER_PHRASES:
        if phrase in phr:
            score += 15
            signals.append({
                'tier': 1,
                'source': 'phr',
                'signal': f'Developer language: "{phrase}"',
                'weight': 15,
                'reasoning': 'PHR indicates tool creation, not usage'
            })
            break  # Only count once

    # Signal 1.4: PHR User Language (-15 points)
    if any(phrase in phr for phrase in TIER1_PHR_USER_PHRASES):
        score -= 15
        signals.append({
            'tier': 1,
            'source': 'phr',
            'signal': 'User language detected',
            'weight': -15,
            'reasoning': 'Project is applying tools, not creating them'
        })

    # Signal 1.5: Title Developer Keywords (+10 points)
    if any(pattern in title for pattern in TIER1_TITLE_DEVELOPER_PATTERNS):
        score += 10
        signals.append({
            'tier': 1,
            'source': 'title',
            'signal': 'Developer intent in title',
            'weight': 10,
            'reasoning': 'Title suggests tool/platform development'
        })

    return score, signals


# ============================================================================
# TIER 2: Abstract Signals
# Weight Range: -10 to +25 points
# ============================================================================

TIER2_DEVELOPER_PHRASES = [
    'we will develop', 'we will design', 'we will create',
    'we will build', 'we propose to develop',
    'create a novel', 'design and validate',
]

TIER2_COMMERCIAL_PHRASES = [
    'commercialize', 'fda approval', 'market',
    'spinout', 'startup', 'regulatory pathway',
    'clinical translation', 'technology transfer',
]

TIER2_USER_PHRASES = [
    'we will use', 'we will apply', 'we will employ',
    'leveraging', 'using state-of-the-art',
]


def apply_tier_2(abstract: str, score: float, signals: List[Dict]) -> Tuple[float, List[Dict]]:
    """
    Apply Tier 2: Abstract Signals.
    """
    abstract_text = (abstract or '').lower()

    # Signal 2.1: Abstract Developer Language (+10 points)
    if any(phrase in abstract_text for phrase in TIER2_DEVELOPER_PHRASES):
        score += 10
        signals.append({
            'tier': 2,
            'source': 'abstract',
            'signal': 'Developer language in abstract',
            'weight': 10,
            'reasoning': 'Abstract indicates tool development'
        })

    # Signal 2.2: Commercial Intent (+15 points)
    if any(phrase in abstract_text for phrase in TIER2_COMMERCIAL_PHRASES):
        score += 15
        signals.append({
            'tier': 2,
            'source': 'abstract',
            'signal': 'Commercial intent language',
            'weight': 15,
            'reasoning': 'Explicit commercialization intent'
        })

    # Signal 2.3: Abstract User Language (-10 points)
    if any(phrase in abstract_text for phrase in TIER2_USER_PHRASES):
        score -= 10
        signals.append({
            'tier': 2,
            'source': 'abstract',
            'signal': 'User language in abstract',
            'weight': -10,
            'reasoning': 'Abstract indicates tool usage, not development'
        })

    return score, signals


# ============================================================================
# TIER 3: Publication Signals
# Weight Range: -15 to +25 points
# ============================================================================

def apply_tier_3(publications: List[Dict], score: float, signals: List[Dict]) -> Tuple[float, List[Dict]]:
    """
    Apply Tier 3: Publication Signals.
    """
    if not publications:
        return score, signals

    # Count journal types
    methods_count = sum(1 for p in publications if p.get('is_methods_journal'))
    therapeutic_count = sum(1 for p in publications if p.get('is_therapeutic_journal'))
    pub_count = len(publications)

    # Signal 3.1: Methods Journal Publications (+10 per pub, cap 25)
    if methods_count > 0:
        weight = min(methods_count * 10, 25)
        score += weight
        signals.append({
            'tier': 3,
            'source': 'publications',
            'signal': f'{methods_count} methods journal publications',
            'weight': weight,
            'reasoning': 'Methods journals indicate tool development'
        })

    # Signal 3.2: Therapeutic Journal Publications (-5 per pub, cap -15)
    if therapeutic_count > 0:
        weight = -min(therapeutic_count * 5, 15)
        score += weight
        signals.append({
            'tier': 3,
            'source': 'publications',
            'signal': f'{therapeutic_count} therapeutic journal publications',
            'weight': weight,
            'reasoning': 'Therapeutic journals indicate disease research'
        })

    # Signal 3.3: Publication Volume (-10 if >10 pubs)
    if pub_count > 10:
        score -= 10
        signals.append({
            'tier': 3,
            'source': 'publications',
            'signal': f'{pub_count} publications (high academic output)',
            'weight': -10,
            'reasoning': 'Many publications suggests academic focus'
        })

    return score, signals


# ============================================================================
# TIER 4: Patent Signals
# Weight Range: -25 to +40 points
# ============================================================================

def apply_tier_4(patents: List[Dict], publications: List[Dict], score: float, signals: List[Dict]) -> Tuple[float, List[Dict]]:
    """
    Apply Tier 4: Patent Signals.
    """
    if not patents:
        return score, signals

    # Count patent types
    device_count = sum(1 for p in patents if p.get('is_device_patent'))
    therapeutic_count = sum(1 for p in patents if p.get('is_therapeutic_patent'))
    patent_count = len(patents)
    pub_count = len(publications) if publications else 0

    # Signal 4.1: Device/System Patents (+20 per patent, cap 40)
    if device_count > 0:
        weight = min(device_count * 20, 40)
        score += weight
        signals.append({
            'tier': 4,
            'source': 'patents',
            'signal': f'{device_count} device/system patents',
            'weight': weight,
            'reasoning': 'Device patents indicate tool commercialization'
        })

    # Signal 4.2: Therapeutic Patents (-10 per patent, cap -25)
    if therapeutic_count > 0:
        weight = -min(therapeutic_count * 10, 25)
        score += weight
        signals.append({
            'tier': 4,
            'source': 'patents',
            'signal': f'{therapeutic_count} therapeutic patents',
            'weight': weight,
            'reasoning': 'Therapeutic patents indicate drug development'
        })

    # Signal 4.3: Patent-to-Publication Ratio (+15 if ratio >0.5)
    if patent_count > 0 and pub_count > 0:
        ratio = patent_count / pub_count
        if ratio > 0.5:
            score += 15
            signals.append({
                'tier': 4,
                'source': 'patents',
                'signal': f'Patent/pub ratio: {ratio:.2f}',
                'weight': 15,
                'reasoning': 'High ratio suggests commercial focus'
            })

    return score, signals


# ============================================================================
# TIER 5: Clinical Trials (Exclusion Filter)
# Weight Range: -30 to 0 points
# ============================================================================

def apply_tier_5(clinical_studies: List[Dict], score: float, signals: List[Dict]) -> Tuple[float, List[Dict]]:
    """
    Apply Tier 5: Clinical Trial Exclusion Filter.
    """
    if not clinical_studies:
        return score, signals

    # Check if any are diagnostic/device trials
    diagnostic_count = sum(1 for s in clinical_studies if s.get('is_diagnostic_trial'))
    therapeutic_count = sum(1 for s in clinical_studies if s.get('is_therapeutic_trial'))

    if diagnostic_count > 0 and therapeutic_count == 0:
        # Diagnostic trials only - mild penalty
        score -= 10
        signals.append({
            'tier': 5,
            'source': 'clinical_studies',
            'signal': f'{diagnostic_count} diagnostic clinical trials',
            'weight': -10,
            'reasoning': 'Diagnostic trials may still be biotools'
        })
    elif therapeutic_count > 0:
        # Therapeutic trials - strong penalty
        score -= 30
        signals.append({
            'tier': 5,
            'source': 'clinical_studies',
            'signal': f'{therapeutic_count} therapeutic clinical trials',
            'weight': -30,
            'reasoning': 'Clinical trials strongly indicate drug development'
        })

    return score, signals


# ============================================================================
# REASONING GENERATION
# ============================================================================

def generate_reasoning(score: float, signals: List[Dict], confidence: str) -> str:
    """
    Generate human-readable reasoning for the classification.
    """
    positive_signals = [s for s in signals if s['weight'] > 0]
    negative_signals = [s for s in signals if s['weight'] < 0]

    # Start with classification summary
    if confidence == 'HIGH':
        reasoning = "This is a high-confidence biotools developer. "
    elif confidence == 'MODERATE':
        reasoning = "This appears to be a biotools developer, but with some uncertainty. "
    else:
        reasoning = "This is unlikely to be a biotools developer. "

    # Add key positive signals
    if positive_signals:
        top_positive = sorted(positive_signals, key=lambda x: x['weight'], reverse=True)[:3]
        reasoning += "Key indicators: "
        reasoning += "; ".join([s['signal'] for s in top_positive])
        reasoning += ". "

    # Add key negative signals
    if negative_signals:
        top_negative = sorted(negative_signals, key=lambda x: x['weight'])[:2]
        reasoning += "However: "
        reasoning += "; ".join([s['signal'] for s in top_negative])
        reasoning += ". "

    return reasoning.strip()


# ============================================================================
# MAIN CLASSIFICATION FUNCTION
# ============================================================================

def classify_biotools_confidence(
    project: Dict[str, Any],
    abstract: Optional[str] = None,
    publications: Optional[List[Dict]] = None,
    patents: Optional[List[Dict]] = None,
    clinical_studies: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """
    Classify a project's biotools confidence using the 5-tier algorithm.

    Args:
        project: Project dictionary with fields like funding_mechanism, org_type, phr, title
        abstract: Optional abstract text
        publications: Optional list of publication dictionaries
        patents: Optional list of patent dictionaries
        clinical_studies: Optional list of clinical study dictionaries

    Returns:
        Dictionary with score, confidence, signals, and reasoning
    """
    score = 0.0
    signals: List[Dict] = []

    # Tier 1: Core signals (always available)
    score, signals = apply_tier_1(project, score, signals)

    # Tier 2: Abstract signals (if available)
    if abstract:
        score, signals = apply_tier_2(abstract, score, signals)

    # Tier 3: Publication signals (if available)
    if publications:
        score, signals = apply_tier_3(publications, score, signals)

    # Tier 4: Patent signals (if available)
    if patents:
        score, signals = apply_tier_4(patents, publications or [], score, signals)

    # Tier 5: Clinical trial filter (if available)
    if clinical_studies:
        score, signals = apply_tier_5(clinical_studies, score, signals)

    # Clamp score to 0-100
    final_score = max(0, min(100, score))

    # Determine confidence level
    if final_score >= 60:
        confidence = 'HIGH'
    elif final_score >= 35:
        confidence = 'MODERATE'
    else:
        confidence = 'LOW'

    # Generate reasoning
    reasoning = generate_reasoning(final_score, signals, confidence)

    return {
        'score': final_score,
        'confidence': confidence,
        'signals': signals,
        'reasoning': reasoning,
    }


# ============================================================================
# TESTING
# ============================================================================

if __name__ == '__main__':
    # Test case 1: SBIR biotools company
    print("Test 1: SBIR Biotools Company")
    project1 = {
        'funding_mechanism': 'SBIR-STTR RPGS',
        'org_type': 'company',
        'phr': 'We will develop a prototype instrument for high-throughput protein analysis that will enable researchers to rapidly screen samples.',
        'title': 'Development of a Novel Protein Microarray Platform',
    }
    result1 = classify_biotools_confidence(project1)
    print(f"  Score: {result1['score']}, Confidence: {result1['confidence']}")
    print(f"  Reasoning: {result1['reasoning']}")

    # Test case 2: Academic tool user
    print("\nTest 2: Academic Tool User")
    project2 = {
        'funding_mechanism': 'OTHER',
        'org_type': 'university',
        'phr': 'We will use recently developed techniques to investigate the mechanisms underlying disease X.',
        'title': 'Investigating Disease Mechanisms Using Advanced Imaging',
    }
    result2 = classify_biotools_confidence(project2)
    print(f"  Score: {result2['score']}, Confidence: {result2['confidence']}")
    print(f"  Reasoning: {result2['reasoning']}")

    # Test case 3: Therapeutic company with clinical trial
    print("\nTest 3: Therapeutic Company with Clinical Trial")
    project3 = {
        'funding_mechanism': 'SBIR-STTR RPGS',
        'org_type': 'company',
        'phr': 'We will develop a novel therapeutic compound for the treatment of cancer.',
        'title': 'Novel Immunotherapy for Cancer Treatment',
    }
    clinical3 = [{'is_therapeutic_trial': True, 'is_diagnostic_trial': False}]
    result3 = classify_biotools_confidence(project3, clinical_studies=clinical3)
    print(f"  Score: {result3['score']}, Confidence: {result3['confidence']}")
    print(f"  Reasoning: {result3['reasoning']}")
