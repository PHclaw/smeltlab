"""Quick test script for GLM integration."""
import httpx
import json
import sys
sys.path.insert(0, '.')

from app.services.profiler import profile_data, read_file
from app.services.cleaner import _CLEAN_PLAN_PROMPT

# Load test data
df = read_file('test_data.csv', 'csv')
profile = profile_data(df, 460)

# Build prompt
schema_info = [{
    "name": c.name, "type": c.inferred_type,
    "null_pct": c.null_pct, "unique_pct": c.unique_pct,
    "sample_values": c.sample_values[:3], "issues": c.issues,
} for c in profile.columns]

sample_rows = df.head(5).to_dicts()
for row in sample_rows:
    for k, v in row.items():
        if not isinstance(v, (str, int, float, bool, type(None))):
            row[k] = str(v)

issues_summary = "; ".join(f"[{i.severity}] {i.message}" for i in profile.issues[:10])

prompt = _CLEAN_PLAN_PROMPT.format(
    schema_json=json.dumps(schema_info, indent=2, ensure_ascii=False),
    total_rows=profile.total_rows,
    total_columns=profile.total_columns,
    health_score=profile.health_score,
    duplicate_rows=profile.duplicate_rows,
    duplicate_pct=profile.duplicate_pct,
    issues_summary=issues_summary or "None",
    sample_json=json.dumps(sample_rows, indent=2, ensure_ascii=False, default=str),
    instruction="Remove duplicates and mask emails",
)

print(f"Prompt length: {len(prompt)} chars")

# Call GLM
key = '4d02cb9ab30545248004fe0ce717d1fc.hHIrMBBbHKTZAc2M'
resp = httpx.post(
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
    json={
        'model': 'GLM-4.5-Air',
        'messages': [
            {'role': 'system', 'content': 'You are an expert data engineer. Always respond with valid JSON only, no markdown fences, no explanation.'},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.3,
        'max_tokens': 4096,
        'stream': False,
    },
    timeout=120,
)

data = resp.json()
msg = data['choices'][0]['message']
content = msg.get('content', '')
reasoning = msg.get('reasoning_content', '')

print(f"\nContent ({len(content)} chars):")
print(content[:800] if content else "(empty)")
print(f"\nReasoning ({len(reasoning)} chars):")
print(reasoning[:300] if reasoning else "(empty)")
print(f"\nUsage: {data.get('usage', {})}")

# Try to parse as JSON
if content:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()
    try:
        plan = json.loads(cleaned)
        print(f"\nParsed plan:")
        print(f"  Reasoning: {plan.get('reasoning', '')[:100]}")
        print(f"  Steps: {len(plan.get('steps', []))}")
        for s in plan.get('steps', []):
            print(f"    - {s['operation']}: {s.get('description', '')}")
    except json.JSONDecodeError as e:
        print(f"\nJSON parse error: {e}")
