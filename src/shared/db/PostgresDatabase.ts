import { Pool, type PoolClient, type PoolConfig, type QueryResult as PgQueryResult } from 'pg'

import type { Database, DatabaseTransaction, QueryResult, QueryResultRow } from './Database.js'

class PostgresQueryable implements DatabaseTransaction {
  constructor(private readonly client: Pool | PoolClient) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = (await this.client.query(text, [...params])) as PgQueryResult<T>

    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    }
  }
}

export class PostgresDatabase implements Database {
  private readonly pool: Pool

  private readonly queryable: PostgresQueryable

  constructor(configuration: PoolConfig) {
    this.pool = new Pool(configuration)
    this.queryable = new PostgresQueryable(this.pool)
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
      const transaction = new PostgresQueryable(client)
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