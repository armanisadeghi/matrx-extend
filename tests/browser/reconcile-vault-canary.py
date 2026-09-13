"""Read-only exact mutation provenance for owned extension canary cleanup; no secret columns."""
import asyncio, json, os, sys, uuid
import asyncpg
from dotenv import load_dotenv
async def main():
 actor, org, *raw_keys = sys.argv[1:]
 actor, org = str(uuid.UUID(actor)), str(uuid.UUID(org))
 keys = list(dict.fromkeys(str(uuid.UUID(k)) for k in raw_keys))
 if not 1 <= len(keys) <= 4: raise ValueError('key_count')
 load_dotenv('/Users/armanisadeghi/code/aidream/.env')
 c=await asyncpg.connect(host=os.environ['SUPABASE_MATRIX_HOST'],port=int(os.environ['SUPABASE_MATRIX_PORT']),database=os.environ['SUPABASE_MATRIX_DATABASE_NAME'],user=os.environ['SUPABASE_MATRIX_USER'],password=os.environ['SUPABASE_MATRIX_PASSWORD'],ssl='require',statement_cache_size=0,timeout=15)
 try:
  async with c.transaction(readonly=True):
   await c.execute("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1500ms'")
   identity=await c.fetchval('SELECT email FROM auth.users WHERE id=$1::uuid',actor)
   if identity != 'admin@admin.com': raise ValueError('identity')
   rows=await c.fetch('''SELECT r.mutation_id::text, r.result_item_id::text,
        i.user_id::text, i.organization_id::text, i.deleted_at IS NOT NULL AS retired
        FROM users.credential_mutation_receipts r
        JOIN users.credential_items i ON i.id=r.result_item_id
        WHERE r.actor_id=$1::uuid AND r.organization_id=$2::uuid
          AND r.mutation_id=ANY($3::uuid[]) AND r.operation='create_item'
          AND r.principal_type='user' AND r.principal_id=$1::uuid
          AND r.target_item_id IS NULL AND r.completed_at IS NOT NULL''',actor,org,keys)
   if any(row['user_id']!=actor or row['organization_id'] is not None for row in rows): raise ValueError('item_scope')
   if len({row['mutation_id'] for row in rows}) != len(rows): raise ValueError('receipt_duplicates')
   print(json.dumps({'results':[dict(row) for row in rows]}))
 finally: await c.close()
if __name__=='__main__':
 try: asyncio.run(main())
 except Exception as exc:
  print(json.dumps({'error':type(exc).__name__}));sys.exit(1)
