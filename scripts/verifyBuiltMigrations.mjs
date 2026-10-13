import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const sourceDirectory = path.join(repositoryRoot, 'src', 'migrations')
const builtDirectory = path.join(repositoryRoot, 'dist', 'src', 'migrations')
const builtServer = path.join(repositoryRoot, 'dist', 'src', 'server.js')
const builtReadiness = path.join(
  repositoryRoot,
  'dist',
  'src',
  'config',
  'startupReadiness.js',
)

async function sqlFileNames(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

function assertSameNames(sourceNames, builtNames) {
  if (JSON.stringify(sourceNames) !== JSON.stringify(builtNames)) {
    throw new Error(
      `Built migration filename mismatch: source=${sourceNames.join(',')} built=${builtNames.join(',')}`,
    )
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

const sourceNames = await sqlFileNames(sourceDirectory)
const builtNames = await sqlFileNames(builtDirectory)
assertSameNames(sourceNames, builtNames)

for (const fileName of sourceNames) {
  const [source, built] = await Promise.all([
    readFile(path.join(sourceDirectory, fileName)),
    readFile(path.join(builtDirectory, fileName)),
  ])
  if (sha256(source) !== sha256(built)) {
    throw new Error(`Built migration content mismatch for ${fileName}`)
  }
}

await readFile(builtServer)
const {
  getStartupReadinessReport,
  resolveServerMigrationsDirectory,
} = await import(
  pathToFileURL(builtReadiness).href
)
const resolvedDirectory = resolveServerMigrationsDirectory(
  pathToFileURL(builtServer).href,
)
if (resolvedDirectory !== builtDirectory) {
  throw new Error(
    `Compiled server resolves migrations to ${resolvedDirectory}, expected ${builtDirectory}`,
  )
}

const readiness = await getStartupReadinessReport(
  {
    query: async (statement) => ({
      rows: statement.includes('schema_migrations')
        ? builtNames.map((version) => ({ version }))
        : [{ ok: 1 }],
      rowCount: statement.includes('schema_migrations') ? builtNames.length : 1,
    }),
  },
  resolvedDirectory,
  { nodeEnv: 'production' },
)
if (readiness.pendingMigrations.length > 0) {
  throw new Error(
    `Compiled readiness did not recognize built migrations: ${readiness.pendingMigrations.join(',')}`,
  )
}

process.stdout.write(
  `${JSON.stringify({
    message: 'built migrations verified',
    migrationCount: builtNames.length,
    migrationsDirectory: builtDirectory,
    readinessPendingMigrations: readiness.pendingMigrations.length,
  })}\n`,
)
