#!/bin/bash
# Run this from Terminal.app (not VS Code terminal) to create clean batch files
# Usage: ./etl/export_clean_batches.sh

cd "$(dirname "$0")/.."

echo "Exporting batches 2428-3084 to etl/clean_batches/"
mkdir -p etl/clean_batches

python3 etl/export_for_claude_max.py --offset=121350 --start-batch=2428 2>&1 | while read line; do
    echo "$line"
done

# Move generated files to clean_batches
for i in $(seq 2428 3084); do
    src="etl/claude_max_batches/batch_$(printf '%04d' $i).txt"
    dst="etl/clean_batches/batch_$(printf '%04d' $i).txt"
    if [ -f "$src" ]; then
        mv "$src" "$dst"
    fi
done

echo ""
echo "Files exported to etl/clean_batches/"
echo "Check xattrs: xattr etl/clean_batches/batch_2428.txt"
