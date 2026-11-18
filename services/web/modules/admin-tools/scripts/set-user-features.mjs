import minimist from 'minimist'
import { fromZodError } from 'zod-validation-error'
import { db } from '../../../app/src/infrastructure/mongodb.mjs'
import { isFeatureOn } from '../../instance-features/app/src/UserFeatures.mjs'
import AdminUserManager, { updateSchema } from '../app/src/AdminUserManager.mjs'

// Turns switches of the admin panel's Features tab on or off for many accounts
// at once, e.g. GitLab and Gitea for everyone. Each account goes through the
// same update as the tab: the value outlives a refresh of the features, the
// account's audit log names the given admin, and Dropbox off unlinks it. An
// account that has the value already is left alone, so a switch never turned
// off stays unset in the database, which counts as on.
//
// In the sharelatex container, from /overleaf/services/web:
//   node modules/admin-tools/scripts/set-user-features.mjs \
//     --admin=admin@example.com --gitlab=false --gitea=false --all
//   node modules/admin-tools/scripts/set-user-features.mjs \
//     --admin=admin@example.com --gitlab=true --email=a@example.com
// It only lists what it would change until --dry-run=false is added.

const USAGE = `Usage: node modules/admin-tools/scripts/set-user-features.mjs --admin=<admin email> --<switch>=true|false ... (--all | --email=<email> ...) [--dry-run=false]`

const OPTIONS = ['_', 'admin', 'email', 'all', 'dry-run']

function fail(message) {
  console.error(message)
  console.error(USAGE)
  process.exit(101)
}

function parseArgs() {
  const argv = minimist(process.argv.slice(2), {
    string: ['admin', 'email', 'dry-run'],
    boolean: ['all'],
  })
  const features = {}
  for (const [key, value] of Object.entries(argv)) {
    if (OPTIONS.includes(key)) continue
    if (value !== 'true' && value !== 'false') {
      fail(`--${key} takes true or false`)
    }
    features[key] = value === 'true'
  }
  if (Object.keys(features).length === 0) fail('No switch given')
  const parsed = updateSchema.safeParse({ features })
  if (!parsed.success) fail(fromZodError(parsed.error).message)

  const emails = [argv.email ?? []].flat().map(email => email.toLowerCase())
  if (argv.all === emails.length > 0) fail('Give either --all or --email')
  if (!argv.admin) fail('No --admin given')
  return {
    features,
    emails,
    adminEmail: argv.admin.toLowerCase(),
    dryRun: argv['dry-run'] !== 'false',
  }
}

async function* accounts(emails) {
  const projection = { _id: 1, email: 1, features: 1 }
  if (emails.length === 0) {
    yield* db.users.find({}, { projection })
    return
  }
  for (const email of emails) {
    yield (await db.users.findOne({ email }, { projection })) ?? { email }
  }
}

async function main() {
  const { features, emails, adminEmail, dryRun } = parseArgs()
  const admin = await db.users.findOne(
    { email: adminEmail },
    { projection: { _id: 1, isAdmin: 1 } }
  )
  if (!admin?.isAdmin) fail(`${adminEmail} is not an admin account`)

  const counts = { changed: 0, unchanged: 0, skipped: 0, failed: 0 }
  for await (const user of accounts(emails)) {
    if (!user._id) {
      console.log(`${user.email}: no such account`)
      counts.failed++
      continue
    }
    // what the tab sends: only the switches that change
    const changes = Object.fromEntries(
      Object.entries(features).filter(
        ([key, value]) => isFeatureOn(user, key) !== value
      )
    )
    if (Object.keys(changes).length === 0) {
      counts.unchanged++
      continue
    }
    // the panel refuses changes to the admin's own features
    if (user._id.equals(admin._id)) {
      console.log(`${user.email}: skipped, the --admin account itself`)
      counts.skipped++
      continue
    }
    const summary = Object.entries(changes)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')
    if (dryRun) {
      console.log(`${user.email}: would set ${summary}`)
      counts.changed++
      continue
    }
    try {
      await AdminUserManager.updateUser(
        user._id.toString(),
        { features: changes },
        { id: admin._id.toString(), ip: '127.0.0.1' }
      )
      console.log(`${user.email}: set ${summary}`)
      counts.changed++
    } catch (error) {
      console.log(`${user.email}: failed, ${error.message}`)
      counts.failed++
    }
  }

  console.log(
    `${dryRun ? 'Would change' : 'Changed'} ${counts.changed}, unchanged ${counts.unchanged}, skipped ${counts.skipped}, failed ${counts.failed}`
  )
  if (dryRun) console.log('Dry run: add --dry-run=false to apply')
  return counts.failed === 0
}

main()
  .then(ok => process.exit(ok ? 0 : 1))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
