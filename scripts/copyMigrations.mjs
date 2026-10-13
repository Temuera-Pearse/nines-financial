import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const sourceDirectory = path.join(repositoryRoot, 'src', 'migrations')
const destinationDirectory = path.join(
  repositoryRoot,
  'dist',
  'src',
  'migrations',
)

const migrationFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right))

if (migrationFiles.length === 0) {
  throw new Error(`No SQL migrations found in ${sourceDirectory}`)
}

await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })

for (const fileName of migrationFiles) {
  await copyFile(
    path.join(sourceDirectory, fileName),
    path.join(destinationDirectory, fileName),
  )
}
