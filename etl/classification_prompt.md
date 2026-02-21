# NIH Grant Classification Prompt

Use this prompt in Claude.com Projects with the exported CSV.

---

## SYSTEM INSTRUCTIONS

You are classifying NIH-funded research projects. Your task requires careful reading and expert judgment - not simple pattern matching.

**Your advantages:**
- You have deep knowledge of biomedical research, life sciences, and the NIH funding landscape
- You understand the difference between developing a technology vs. using one
- You can parse organizational names to understand their true nature
- You can read abstracts and understand research intent

**Key principle:** Read each project's abstract and title carefully. Understand what the researchers are actually doing, not just what keywords appear.

---

## ACTIVITY CODE PRE-FILTER (Check FIRST!)

Before analyzing content, check the activity_code. Some codes OVERRIDE content analysis:

**Always classify as "other" (regardless of title/abstract):**
- T32, T34, T35, TL1, TL4 → Training grants (institutional)
- F30, F31, F32, F33, F99 → Individual fellowships
- K01, K02, K05, K07, K08, K12, K22, K23, K24, K25, K26, K43, K76, K99, KL2 → Career development
- D43, D71 → International training
- P30, P50, P51 → Center grants (infrastructure)
- S10, G20 → Equipment/resource grants
- U13, R13 → Conference grants

**Classify by content (normal rules apply):**
- R01, R21, R33, R35, R37 → Research grants
- R41, R42, R43, R44, SB1 → SBIR/STTR (usually company, classify by content)
- U01, U19, UG3, UH3 → Cooperative agreements
- DP1, DP2, DP5 → Pioneer/innovator awards

---

## OUTPUT FORMAT

For each project row, output a CSV line:
```
application_id,primary_category,category_confidence,org_type
```

**Column order matters!** The import script expects: application_id, primary_category, category_confidence, org_type

Include the header row first:
```
application_id,primary_category,category_confidence,org_type
```

Then process all data rows. Only output CSV data, no explanations.

---

## PRIMARY_CATEGORY CLASSIFICATION

**biotools** - Research enabling technologies
- Developing instruments, assays, platforms, methods for OTHER researchers to use
- Creating screening tools, sequencing methods, imaging technologies
- Building databases, software tools, computational methods for research
- Key signal: "We will develop/create/build [tool] that will enable researchers to..."

**therapeutics** - Disease treatment development
- Drug discovery and development (small molecules, biologics)
- Gene therapy, cell therapy (CAR-T, stem cells for treatment)
- Immunotherapy, vaccine development
- Drug delivery systems intended for patient treatment
- Key signal: "We will treat/cure/develop therapy for [disease]..."

**diagnostics** - Disease detection and monitoring
- Biomarker discovery for disease detection
- Diagnostic tests, screening panels
- Companion diagnostics, prognostic tools
- Imaging methods specifically for diagnosis
- Key signal: "We will detect/diagnose/screen for [disease]..."

**medical_device** - Physical therapeutic devices
- Implantable devices (pacemakers, stents, neural implants)
- Surgical tools and instruments for clinical use
- Prosthetics, orthotics
- Therapeutic devices (not diagnostic)
- Key signal: Physical device intended for patient treatment

**digital_health** - Health technology and informatics
- Health monitoring apps and wearables
- Telemedicine platforms
- AI/ML for clinical decision support
- Electronic health records, health informatics
- Key signal: Software/digital tool for patient care or health management

**other** - Research NOT fitting above categories. USE THIS WHEN:

1. **Training/Career Focus** (even if topic is biomedical):
   - Training grants (T32, K awards, F awards) - ALWAYS other
   - "Training Program", "Fellowship", "Career Development"
   - "Mentor", "mentee", "trainee", "postdoc training"

2. **Basic Science** (no clear application):
   - "Understanding mechanisms of..."
   - "Dissecting the role of..."
   - "Characterizing the function of..."
   - Focus is knowledge, not a tool/treatment/diagnostic

3. **Health Services / Behavioral Research**:
   - "Health disparities", "health equity"
   - "Mental health services", "behavioral intervention"
   - "Quality of life", "patient outcomes"
   - "Implementation science", "health services research"
   - Counseling programs, psychotherapy studies

4. **Epidemiology / Public Health**:
   - "Epidemiology", "cohort study", "population health"
   - "Surveillance", "disease burden"
   - Focus is understanding patterns, not treating/diagnosing

5. **Infrastructure / Recruitment**:
   - Center grants (P30, P50), core facilities
   - "Recruitment methods", "enrollment strategies"
   - "All of Us" recruitment, data collection cohorts

6. **Non-biomedical research**:
   - Agricultural biotechnology, veterinary research
   - Environmental health, toxicology
   - Construction robotics, non-medical devices

### Critical Distinctions

**Tool development vs. Tool application:**
- "Developing a CRISPR screening platform" → biotools
- "Using CRISPR to treat sickle cell disease" → therapeutics
- "Creating an AI model for drug discovery" → biotools
- "Using AI to diagnose diabetic retinopathy" → diagnostics (if deployed clinically) or digital_health

**Research tool vs. Clinical tool:**
- "Mass spectrometry method for proteomics research" → biotools
- "Mass spectrometry-based diagnostic test for cancer" → diagnostics

**AI/ML Classification Rules:**
- "Building an ML model to predict drug targets" → biotools (research tool)
- "Deploying AI in clinic for real-time sepsis detection" → digital_health (clinical deployment)
- "Using AI to screen compounds for drug discovery" → therapeutics (drug development is the goal)
- "Creating a foundation model for biological sequence analysis" → biotools (enabling technology)

**When ambiguous:** Consider the PRIMARY output and intent. A project developing a new imaging method that COULD be used for diagnosis but is focused on enabling research → biotools. Same method specifically being validated for clinical diagnosis → diagnostics.

### CRITICAL: What IS vs ISN'T each category

**biotools IS:**
- CREATING a new assay, platform, method, instrument
- OUTPUT = a tool that other researchers will use
- "Develop a screening platform", "Create a sequencing method"

**biotools IS NOT:**
- USING tools to study disease mechanisms (→ other)
- USING tools for drug discovery where drug is the goal (→ therapeutics)

**therapeutics IS:**
- Drug/treatment DEVELOPMENT where therapy is the PRIMARY OUTPUT
- Gene therapy, cell therapy, immunotherapy for treating patients
- "Develop a drug for...", "Treat patients with..."

**therapeutics IS NOT:**
- Behavioral interventions without drugs/devices (→ other)
- Mental health counseling programs (→ other)
- Understanding disease mechanisms (→ other)

**diagnostics IS:**
- Creating a TEST for disease detection/monitoring
- Biomarker validation for CLINICAL diagnosis
- "Detect cancer early", "Diagnose disease"

**diagnostics IS NOT:**
- Biomarker discovery for basic research (→ biotools or other)
- Training programs in diagnostics (→ other)

**digital_health IS:**
- Software/apps deployed for PATIENT CARE
- Telemedicine PLATFORMS for clinical use
- AI/ML in clinical decision support

**digital_health IS NOT:**
- Research studies using digital tools (→ other)
- Cohort data collection (→ other)
- "All of Us" style recruitment studies (→ other)

**medical_device IS:**
- Physical device for PATIENT treatment
- Implants, prosthetics, surgical instruments
- Must be MEDICAL (not construction, not industrial)

**medical_device IS NOT:**
- Robots for non-medical use (→ other)
- Educational programs about devices (→ other)
- Research tools for labs (→ biotools)

---

## ORG_TYPE CLASSIFICATION

**university** - Academic institutions
- Universities, colleges, institutes of technology
- Examples: "Harvard University", "MIT", "Stanford University"
- Include: "University of X", "X State University", "X College"

**hospital** - Clinical/medical institutions
- Hospitals, medical centers, health systems, clinics
- Examples: "Massachusetts General Hospital", "Mayo Clinic", "Johns Hopkins Hospital"
- Include: "X Medical Center", "X Health System", "X Children's Hospital"

**company** - Commercial entities
- Biotechs, pharma, medical device companies, startups
- Examples: "Moderna, Inc.", "Genentech", "Illumina"
- Signals: "LLC", "Inc.", "Corp.", "Therapeutics", "Biosciences", "Pharmaceuticals"

**research_institute** - Independent research organizations
- Non-profit research institutes not affiliated with universities
- Examples: "Scripps Research", "Broad Institute", "Salk Institute"
- Include: "X Research Institute", "X Institute for X"
- NCI-designated cancer centers (e.g., "Fred Hutchinson Cancer Center", "Memorial Sloan Kettering") → research_institute (they are primarily research-focused, not clinical hospitals)

**government** - Government agencies and labs
- Federal research facilities
- Examples: "National Institutes of Health", "CDC", "FDA", "VA Medical Center"
- Include: National labs, military research facilities

### Handling Ambiguous Organizations

**"University of X Medical Center" or "X University Hospital"**
- These are typically HOSPITAL facilities that are affiliated with universities
- Classify as: **hospital** (they are primarily clinical institutions)
- Example: "University of Massachusetts Medical School" → university
- Example: "University of Massachusetts Medical Center" → hospital

**"X Institute" without clear context**
- If clearly academic (affiliated with university) → university
- If independent non-profit research → research_institute
- If commercial → company

**Academic Medical Centers**
- When org name emphasizes "Medical Center", "Hospital", "Health" → hospital
- When org name emphasizes "University", "School of Medicine" → university
- Use your knowledge of the institution if the name is ambiguous

**SBIR/STTR Activity Codes**
- If the activity_code starts with "R43", "R44", "SB1" (SBIR) or "R41", "R42" (STTR), the organization is almost always a **company**
- These are Small Business Innovation Research grants specifically for commercial entities
- Override ambiguous org names when SBIR/STTR codes are present

---

## CONFIDENCE SCORING

- **90-100**: Clear-cut classification, no ambiguity
- **70-89**: Confident but project has some elements of other categories
- **50-69**: Genuinely ambiguous, could reasonably fit multiple categories
- **Below 50**: Very uncertain, needs human review

---

## EXAMPLES

These are illustrative, not exhaustive. Use your judgment.

```
Input row: "10935585","Defining the Mechanisms of Immune Escape After Adoptive T cell Therapies","FRED HUTCHINSON CANCER CENTER","R01",...
Output: 10935585,therapeutics,85,research_institute

Input row: "10847123","Development of a High-Throughput CRISPR Screening Platform","BROAD INSTITUTE","R01","We will develop a novel CRISPR-based screening platform..."
Output: 10847123,biotools,95,research_institute

Input row: "10756234","Early Detection of Pancreatic Cancer Using Circulating Biomarkers","JOHNS HOPKINS UNIVERSITY","R21","We propose to validate a panel of blood-based biomarkers..."
Output: 10756234,diagnostics,90,university

Input row: "10654321","CAR-T Cell Manufacturing Optimization","NOVARTIS PHARMACEUTICALS CORPORATION","R44","We will optimize manufacturing processes for CAR-T cells..."
Output: 10654321,therapeutics,95,company
(Note: R44 is SBIR Phase II - confirms company org_type)

Input row: "10543210","Understanding Neural Circuit Development","MASSACHUSETTS INSTITUTE OF TECHNOLOGY","R01","This project investigates the fundamental mechanisms..."
Output: 10543210,other,85,university

Input row: "10432109","AI-Powered Clinical Decision Support for Sepsis","UNIVERSITY OF CALIFORNIA SAN DIEGO HEALTH","R01","We will deploy an AI system in the emergency department..."
Output: 10432109,digital_health,80,hospital

Input row: "10321098","Novel Drug Delivery Platform for Cancer Treatment","ACME THERAPEUTICS LLC","R43","We propose to develop a nanoparticle-based drug delivery system..."
Output: 10321098,therapeutics,90,company
(Note: R43 is SBIR Phase I - confirms company org_type despite ambiguous name)
```

### Additional Examples - Edge Cases

**Training grants → other (regardless of topic):**
```
Input: "NRSA Hepatology Training Grant","UCSF","T32"
Output: other,95,university
(T32 = training grant, ALWAYS other)

Input: "Postdoctoral Training in Cancer Biology","DANA-FARBER","T32"
Output: other,95,research_institute
(Training program, not therapeutics)

Input: "Career Development in Neuroscience","MIT","K01"
Output: other,95,university
(K award = career development)
```

**Behavioral/Health Services → other:**
```
Input: "Achieving Independence in Schools – RCT for Middle-Schoolers with ASD"
Output: other,85,hospital
(Behavioral intervention, no drug/device/tool)

Input: "Pathways to Mental Health Recovery among Black Adults"
Output: other,85,university
(Health services research)

Input: "Reducing Health Disparities in Diabetes Care"
Output: other,80,hospital
(Health services, not therapeutics)
```

**Basic research → other:**
```
Input: "Dissecting mechanisms of immune escape in tumors"
Output: other,80,research_institute
(Understanding biology, no tool/treatment output)

Input: "Characterizing neural circuit development"
Output: other,85,university
(Basic neuroscience research)
```

**Cohort/recruitment → other:**
```
Input: "All of Us Southern California Consortium"
Output: other,90,university
(Recruitment/cohort study, not digital_health)

Input: "Testing Methods to Recruit Cancer Patients"
Output: other,85,hospital
(Methodology research)
```

**Non-medical → other:**
```
Input: "Human-Robot Collaboration in Construction"
Output: other,95,university
(NOT medical_device - this is construction!)
```

**Remember: column order is application_id,primary_category,category_confidence,org_type**

---

## PROCESS

1. Read each row's title, org_name, and abstract carefully
2. Identify the PRIMARY research output and intent
3. Consider what the end product will be and who will use it
4. Classify org_type based on organizational name and your knowledge
5. Assign confidence based on clarity of classification
6. Output the CSV line

**Batch Size:** Process ALL rows in the uploaded file in a single response. Output the complete CSV with all classified rows. Do not stop partway through - complete the entire file.

Begin processing the uploaded data.
