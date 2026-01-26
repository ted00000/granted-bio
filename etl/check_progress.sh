#!/bin/bash

# Check ETL progress

echo "==================================="
echo "ETL Progress Checker"
echo "==================================="
echo ""

# Check if process is running
if pgrep -f "load_to_supabase.py" > /dev/null; then
    echo "✓ ETL process is RUNNING"
else
    echo "✗ ETL process is NOT running"
fi

echo ""
echo "Database counts:"
echo "----------------"

PGPASSWORD='qapge0-modjyx-juTqis' psql -h aws-1-us-east-2.pooler.supabase.com -p 5432 -U postgres.oysfqbrqtzcnmxwvxpvd -d postgres << 'EOF'
SELECT
  'Projects' as table_name,
  COUNT(*) as count
FROM projects
UNION ALL
SELECT
  'Abstracts',
  COUNT(*)
FROM abstracts
UNION ALL
SELECT
  'Publications',
  COUNT(*)
FROM publications
UNION ALL
SELECT
  'Patents',
  COUNT(*)
FROM patents
UNION ALL
SELECT
  'Clinical Studies',
  COUNT(*)
FROM clinical_studies
UNION ALL
SELECT
  'Publication Links',
  COUNT(*)
FROM project_publications;

-- Show progress percentage
SELECT
  ROUND((COUNT(*)::numeric / 72312) * 100, 1) as percent_complete
FROM projects;
EOF

echo ""
echo "Recent log output:"
echo "-------------------"
if [ -f ~/etl_log.txt ]; then
    tail -20 ~/etl_log.txt
else
    echo "No log file found at ~/etl_log.txt"
fi

echo ""
echo "==================================="
echo "To view full log: tail -f ~/etl_log.txt"
echo "==================================="
