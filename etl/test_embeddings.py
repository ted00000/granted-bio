"""
Test embedding generation cost on a small sample.
"""

import os
from dotenv import load_dotenv

load_dotenv('.env.local')

try:
    import openai
    from supabase import create_client
except ImportError:
    print("Installing dependencies...")
    import subprocess
    subprocess.check_call(['pip', 'install', 'openai', 'supabase'])
    import openai
    from supabase import create_client

# Initialize clients
openai_client = openai.OpenAI(api_key=os.environ['OPENAI_API_KEY'])
supabase = create_client(
    os.environ['NEXT_PUBLIC_SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)

# Fetch 10 projects with abstracts
print("Fetching 10 sample projects...")
response = supabase.table('projects').select(
    'application_id, title, phr, terms, abstracts(abstract_text)'
).limit(10).execute()

projects = response.data

print(f"Found {len(projects)} projects\n")

total_cost = 0.0
total_tokens = 0

for i, project in enumerate(projects):
    title = project.get('title', '')
    phr = project.get('phr', '')
    terms = project.get('terms', '')
    abstract_data = project.get('abstracts', [])
    abstract = abstract_data[0].get('abstract_text', '') if abstract_data else ''

    # Combine ALL searchable text
    text = f"{title} {phr} {terms} {abstract}"
    text = text[:8000]  # Truncate

    if not text.strip():
        continue

    print(f"[{i+1}/10] Generating embedding...")
    print(f"  Text length: {len(text)} chars")

    # Generate embedding
    embedding_response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )

    tokens = embedding_response.usage.total_tokens
    cost = (tokens / 1000) * 0.00002  # $0.00002 per 1K tokens

    total_tokens += tokens
    total_cost += cost

    print(f"  Tokens: {tokens}")
    print(f"  Cost: ${cost:.6f}\n")

print("=" * 60)
print(f"RESULTS FOR 10 PROJECTS:")
print(f"Total tokens: {total_tokens}")
print(f"Total cost: ${total_cost:.4f}")
print(f"Average cost per project: ${total_cost/len(projects):.6f}")
print(f"\nESTIMATED COST FOR 72,000 PROJECTS:")
print(f"${(total_cost/len(projects)) * 72000:.2f}")
print("=" * 60)
