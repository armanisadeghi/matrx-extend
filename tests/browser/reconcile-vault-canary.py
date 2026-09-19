"""Read-only receipt reconciliation for synthetic Vault canary fixtures.

Returns IDs and receipt facts only. The Node runner uses the normal Vault DELETE
API after this proof establishes exact ownership.
"""
import asyncio
import json
import os
import sys
import uuid

import asyncpg
from dotenv import load_dotenv


async def main():
    actor, organization, *raw_keys = sys.argv[1:]
    actor = str(uuid.UUID(actor))
    organization = str(uuid.UUID(organization))
    keys = list(dict.fromkeys(str(uuid.UUID(key)) for key in raw_keys))
    if not 1 <= len(keys) <= 16:
        raise ValueError('key_count')
    load_dotenv('/Users/armanisadeghi/code/aidream/.env')
    connection = await asyncpg.connect(
        host=os.environ['SUPABASE_MATRIX_HOST'],
        port=int(os.environ['SUPABASE_MATRIX_PORT']),
        database=os.environ['SUPABASE_MATRIX_DATABASE_NAME'],
        user=os.environ['SUPABASE_MATRIX_USER'],
        password=os.environ['SUPABASE_MATRIX_PASSWORD'],
        ssl='require', statement_cache_size=0, timeout=15,
    )
    try:
        async with connection.transaction(readonly=True):
            await connection.execute("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1500ms'")
            if await connection.fetchval('SELECT email FROM auth.users WHERE id=$1::uuid', actor) != 'admin@admin.com':
                raise ValueError('identity')
            rows = await connection.fetch('''
                SELECT r.mutation_id::text, r.result_item_id::text, i.user_id::text,
                       i.organization_id::text, i.deleted_at IS NOT NULL AS retired
                FROM users.credential_mutation_receipts r
                JOIN users.credential_items i ON i.id = r.result_item_id
                WHERE r.actor_id=$1::uuid AND r.organization_id=$2::uuid
                  AND r.mutation_id = ANY($3::uuid[]) AND r.operation='create_item'
                  AND r.principal_type='user' AND r.principal_id=$1::uuid
                  AND r.target_item_id IS NULL AND r.completed_at IS NOT NULL
            ''', actor, organization, keys)
            if len({row['mutation_id'] for row in rows}) != len(rows):
                raise ValueError('receipt_duplicates')
            if any(row['user_id'] != actor or row['organization_id'] is not None for row in rows):
                raise ValueError('item_scope')
            print(json.dumps({'results': [dict(row) for row in rows]}))
    finally:
        await connection.close()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as exc:
        print(json.dumps({'error': type(exc).__name__}))
        raise SystemExit(1)
