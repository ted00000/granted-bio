#!/bin/bash
#
# Load a new fiscal year of data into granted.bio
# Usage: ./scripts/load_fiscal_year.sh [--skip-classification]
#
# Prerequisites:
# - CSV files in data/raw/
# - .env.local configured
# - Database migrations applied (see docs/DATA_LOADING_GUIDE.md)
#

set -e

SKIP_CLASSIFICATION=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-classification)
            SKIP_CLASSIFICATION=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "============================================================"
echo "GRANTED.BIO DATA LOADING PIPELINE"
echo "============================================================"
echo ""

cd "$(dirname "$0")/.."

# Step 1: Load raw data
echo "[1/7] Loading raw data to Supabase..."
python3 etl/load_to_supabase.py --data-dir data/raw
echo "✓ Raw data loaded"
echo ""

# Step 2: Generate project embeddings
echo "[2/7] Generating project embeddings..."
python3 etl/generate_embeddings_batched.py
echo "✓ Project embeddings complete"
echo ""

# Step 3: Generate patent embeddings
echo "[3/7] Generating patent embeddings..."
python3 etl/generate_patent_embeddings.py
echo "✓ Patent embeddings complete"
echo ""

# Step 4: Generate publication embeddings
echo "[4/7] Generating publication embeddings..."
python3 etl/generate_publication_embeddings.py
echo "✓ Publication embeddings complete"
echo ""

# Step 5: Generate clinical study embeddings
echo "[5/7] Generating clinical study embeddings..."
python3 etl/generate_clinical_embeddings.py
echo "✓ Clinical study embeddings complete"
echo ""

# Step 6: Run classification (optional)
if [ "$SKIP_CLASSIFICATION" = false ]; then
    echo "[6/7] Running AI classification..."
    python3 etl/classify_projects_batched.py
    echo "✓ Classification complete"
else
    echo "[6/7] Skipping classification (--skip-classification flag)"
fi
echo ""

# Step 7: Extract emails
echo "[7/7] Extracting emails from publications..."
python3 etl/extract_emails.py
echo "✓ Email extraction complete"
echo ""

# Final audit
echo "============================================================"
echo "RUNNING DATA AUDIT"
echo "============================================================"
python3 etl/data_audit.py

echo ""
echo "============================================================"
echo "DATA LOADING COMPLETE"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Review audit results above"
echo "  2. Test vector search: python3 etl/test_vector_search.py"
echo "  3. Update fiscal year buttons in src/app/search/page.tsx"
echo ""
