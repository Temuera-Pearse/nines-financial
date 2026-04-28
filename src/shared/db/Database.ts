export interface QueryResultRow {
  [column: string]: unknown
}

export interface QueryResult<T extends QueryResultRow> {
  rows: T[]
  rowCount: number
}

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export interface DatabaseTransaction extends Queryable {}

export interface Database extends Queryable {
  tx<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>
  close(): Promise<void>
}