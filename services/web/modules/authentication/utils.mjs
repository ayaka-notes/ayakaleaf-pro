import fs from 'fs'
import UserGetter from '../../app/src/Features/User/UserGetter.mjs'
function readFilesContentFromEnv(envVar) {
// envVar is either a file name: 'file.pem', or string with array: '["file.pem", "file2.pem"]'
  if (!envVar) return undefined
  try {
    const parsedFileNames = JSON.parse(envVar)
    return parsedFileNames.map(filename => fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) { // failed to parse, envVar must be a file name
      return fs.readFileSync(envVar, 'utf8')
    } else {
      throw error
    }
  }
}
function numFromEnv(env) {
  return env ? Number(env) : undefined
}
function boolFromEnv(env) {
  if (env === undefined || env === null) return undefined
  if (typeof env === "string") {
    const envLower = env.toLowerCase()
    if (envLower === 'true') return true
    if (envLower === 'false') return false
  }
  throw new Error("Invalid value for boolean envirionment variable")
}

function splitFullName(fullName) {
  fullName = fullName.trim();
  let lastSpaceIndex = fullName.lastIndexOf(' ');
  let firstNames = fullName.substring(0, lastSpaceIndex).trim();
  let lastName = fullName.substring(lastSpaceIndex + 1).trim();
  return [firstNames, lastName];
}

// ldapjs and node-saml return an attribute with several values as an array
function firstValue(value) {
  return Array.isArray(value) ? value[0] : value
}

// Whether the account has a local password. Policy validators get user
// objects that may not carry hashedPassword (a password reset token's user,
// the session user), so read it from the database.
async function hasPassword(userId) {
  const user = await UserGetter.promises.getUser(userId, { hashedPassword: 1 })
  return Boolean(user?.hashedPassword)
}

export {
  readFilesContentFromEnv,
  numFromEnv,
  boolFromEnv,
  splitFullName,
  firstValue,
  hasPassword,
}
