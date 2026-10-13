import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DataType, newDb, type IMemoryDb } from 'pg-mem'

import type {
  Database,
  DatabaseTransaction,
  QueryResult,
  QueryResultRow,
} from '../../src/shared/db/Database.js'
import { runSqlMigrations } from '../../src/shared/db/migrationRunner.js'

interface PgMemQueryResult<T> {
  rows: T[]
  rowCount: number | null
}

interface PgMemClient {
  query<T>(text: string, params?: unknown[]): Promise<PgMemQueryResult<T>>
  release(): void
}

interface PgMemPool {
  query<T>(text: string, params?: unknown[]): Promise<PgMemQueryResult<T>>
  connect(): Promise<PgMemClient>
  end(): Promise<void>
}

class PgMemQueryable implements DatabaseTransaction {
  constructor(private readonly client: PgMemPool | PgMemClient) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.client.query<T>(text, [...params])

    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    }
  }
}

class PgMemDatabase implements Database {
  private readonly queryable: PgMemQueryable

  constructor(private readonly pool: PgMemPool) {
    this.queryable = new PgMemQueryable(pool)
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.queryable.query<T>(text, params)
  }

  async tx<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const transaction = new PgMemQueryable(client)
      const result = await work(transaction)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

function registerTestFunctions(memoryDatabase: IMemoryDb): void {
  memoryDatabase.public.registerFunction({
    name: 'hashtext', args: [DataType.text], returns: DataType.integer,
    implementation: (value: string) => [...value].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) | 0, 0),
  })
  memoryDatabase.public.registerFunction({
    name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer,
    implementation: () => 1,
  })
  memoryDatabase.public.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
  })
  memoryDatabase.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => value.length,
  })
  memoryDatabase.public.registerFunction({
    name: 'upper',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.toUpperCase(),
  })
  memoryDatabase.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  })
  memoryDatabase.public.registerFunction({
    name: 'greatest',
    args: [DataType.timestamp, DataType.timestamp],
    returns: DataType.timestamp,
    implementation: (left: Date, right: Date) => (left.getTime() >= right.getTime() ? left : right),
  })
  memoryDatabase.public.registerFunction({
    name: 'greatest',
    args: [DataType.timestamptz, DataType.timestamptz],
    returns: DataType.timestamptz,
    implementation: (left: Date, right: Date) => (left.getTime() >= right.getTime() ? left : right),
  })
}

export interface TestDatabaseHarness {
  memoryDatabase: IMemoryDb
  database: Database
  close(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabaseHarness> {
  const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true })
  registerTestFunctions(memoryDatabase)

  const { Pool } = memoryDatabase.adapters.createPg()
  const pool = new Pool() as PgMemPool
  const database = new PgMemDatabase(pool)
  const migrationsDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/migrations',
  )

  await runSqlMigrations(database, migrationsDirectory, {
    // pg-mem does not implement PostgreSQL trigger DDL or PL/pgSQL DO blocks.
    // Real PostgreSQL runs both migrations without these test-only transforms.
    transformMigrationSql: (sql, fileName) => {
      if (fileName === '017_phase_7_token_purchase_attestations.sql') {
        return sql
          .replace(/([a-z_]+) ~ '\^\[0-9a-f\]\{64\}\$'/gu, 'char_length($1) = 64')
          .replace("event_type TEXT NOT NULL CHECK (event_type = 'financial.nines_issuance_decided.v1')",
            "event_type TEXT NOT NULL CHECK (event_type IN ('financial.nines_issuance_decided.v1','financial.nines_issuance_consumed.v1'))")
          .replace(/CREATE OR REPLACE FUNCTION protect_funding_attestation_consumption\(\)[\s\S]*$/u, '')
      }
      if (fileName === '018_legacy_deposit_credit_exactly_once.sql') {
        return sql.replace(/DO \$\$[\s\S]*?\$\$;\s*/u, '')
      }
      if (fileName === '020_nines_issuance_authorization_consumption.sql') {
        return sql
          .replace(/ALTER TABLE security_evidence_outbox DROP CONSTRAINT security_evidence_outbox_event_type_check;\s*ALTER TABLE security_evidence_outbox ADD CONSTRAINT security_evidence_outbox_event_type_check CHECK \([\s\S]*?\);\s*/u, '')
          .replace(/([a-z_]+) ~ '[^']+'/gu, 'char_length($1) > 0')
          .replace(/LENGTH\(/gu, 'char_length(')
          .replace(/\(funding_attestation_id IS NOT NULL\)::INTEGER \+\s*\(issuance_authorization_id IS NOT NULL\)::INTEGER = 1/gu,
            '(funding_attestation_id IS NOT NULL) <> (issuance_authorization_id IS NOT NULL)')
          .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;\s*/gu, '')
          .replace(/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?;\s*/gu, '')
      }
      if (fileName === '021_authenticated_wager_intake_hardening.sql') {
        return sql
          // pg-mem incorrectly uses this partial index for queries whose
          // transaction_type predicate excludes bet_reserve. PostgreSQL runs
          // the unmodified migration and its index is verified in real-PG.
          .replace(/CREATE UNIQUE INDEX IF NOT EXISTS ledger_bet_reserve_reference_unique_idx[\s\S]*?;\s*/u, '')
          .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;\s*/gu, '')
          .replace(/DROP TRIGGER[\s\S]*?;\s*/gu, '')
          .replace(/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?;\s*/gu, '')
      }
      if (fileName === '022_authenticated_race_lifecycle_projection.sql') {
        return sql
          .replace(/([a-z_]+) ~ '[^']+'/gu, 'char_length($1) > 0')
          .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;\s*/gu, '')
          .replace(/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?;\s*/gu, '')
      }
      if (fileName === '023_authenticated_race_result_settlement.sql') {
        return sql
          .replace(/([a-z_]+) ~ '[^']+'/gu, 'char_length($1) > 0')
          .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;\s*/gu, '')
          .replace(/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?;\s*/gu, '')
      }
      if (fileName === '025_authoritative_result_recovery.sql') {
        return sql
          // pg-mem does not retain PostgreSQL's generated name for the inline
          // status check. Real PostgreSQL replaces both checks as written.
          .replace(/ALTER TABLE authoritative_race_results\s+DROP CONSTRAINT[\s\S]*?settlement_shape_check;\s*/u, '')
          .replace(/ALTER TABLE authoritative_race_results\s+ADD CONSTRAINT authoritative_race_results_settlement_status_check[\s\S]*?\n  \);\s*/u, '')
          .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;\s*/gu, '')
      }
      return sql
    },
  })

  return {
    memoryDatabase,
    database,
    close: async () => {
      await database.close()
    },
  }
}
