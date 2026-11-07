import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { promisify } from 'util'
import passport from 'passport'
import ldapjs from 'ldapjs'
import UserGetter from '../../../../../app/src/Features/User/UserGetter.mjs'
import { splitFullName, firstValue } from '../../../utils.mjs'

function _searchLDAP(client, baseDN, options) {
  return new Promise((resolve, reject) => {
    const searchEntries = []
    client.search(baseDN, options, (error, res) => {
      if (error) {
        reject(error)
      } else {
        res.on('searchEntry', entry => searchEntries.push(entry.object))
        res.on('error', reject)
        res.on('end', () => resolve(searchEntries))
      }
    })
  })
}

async function fetchLDAPContacts(userId, contacts) {
  if (!Settings.ldap?.enable || !process.env.OVERLEAF_LDAP_CONTACTS_FILTER) {
    return []
  }

  const ldapOptions = passport._strategy('ldapauth').options.server
  const { attEmail, attFirstName = "", attLastName = "", attName = "" } = Settings.ldap
  const {
    url,
    timeout,
    connectTimeout,
    tlsOptions,
    starttls,
    bindDN,
    bindCredentials
  } = ldapOptions
  const searchBase = process.env.OVERLEAF_LDAP_CONTACTS_SEARCH_BASE || ldapOptions.searchBase
  const searchScope = process.env.OVERLEAF_LDAP_CONTACTS_SEARCH_SCOPE || 'sub'
  const ldapConfig = { url, timeout, connectTimeout, tlsOptions }

  let ldapUsers
  let client

  try {
    await new Promise((resolve, reject) => {
      client = ldapjs.createClient(ldapConfig)
      client.on('error', (error) => { reject(error) })
      client.on('connectTimeout', (error) => { reject(error) })
      client.on('connect', () => { resolve() })
    })

    if (starttls) {
      const starttlsAsync = promisify(client.starttls).bind(client)
      await starttlsAsync(tlsOptions, null)
    }
    const bindAsync = promisify(client.bind).bind(client)
    await bindAsync(bindDN, bindCredentials)

    async function createContactsSearchFilter(client, ldapOptions, userId, contactsFilter) {
      const searchProperty = process.env.OVERLEAF_LDAP_CONTACTS_PROPERTY
      if (!searchProperty) {
        return contactsFilter
      }
      const email = await UserGetter.promises.getUserEmail(userId)
      const searchOptions = {
        scope: ldapOptions.searchScope,
        attributes: [searchProperty],
        filter: `(${Settings.ldap.attEmail}=${email})`
      }
      const searchBase = ldapOptions.searchBase
      const ldapUser = (await _searchLDAP(client, searchBase, searchOptions))[0]
      const searchPropertyValue = ldapUser ? ldapUser[searchProperty]
                                           : process.env.OVERLEAF_LDAP_CONTACTS_NON_LDAP_VALUE || 'IMATCHNOTHING'
      return contactsFilter.replace(/{{userProperty}}/g, searchPropertyValue)
    }

    const filter = await createContactsSearchFilter(client, ldapOptions, userId, process.env.OVERLEAF_LDAP_CONTACTS_FILTER)
    const searchOptions = { scope: searchScope, attributes: [attEmail, attFirstName, attLastName, attName], filter }

    ldapUsers = await _searchLDAP(client, searchBase, searchOptions)
  } catch (error) {
    logger.warn({ error }, 'Error in fetchLDAPContacts')
    return []
  } finally {
    client?.unbind()
  }

  const newLDAPContacts = ldapUsers.reduce((acc, ldapUser) => {
    const email = Array.isArray(ldapUser[attEmail])
                    ? ldapUser[attEmail][0]?.toLowerCase()
                    : ldapUser[attEmail]?.toLowerCase()
    if (!email) return acc
    if (!contacts.some(contact => contact.email === email)) {
      let nameParts = ["", ""]
      if ((!attFirstName || !attLastName) && attName) {
        nameParts = splitFullName(firstValue(ldapUser[attName]) || "")
      }
      const firstName = attFirstName ? (firstValue(ldapUser[attFirstName]) || "") : nameParts[0]
      const lastName  = attLastName  ? (firstValue(ldapUser[attLastName])  || "") : nameParts[1]
      acc.push({
        first_name: firstName,
        last_name: lastName,
        email: email,
        type: 'user'
      })
    }
    return acc
  }, [])

  return newLDAPContacts.sort((a, b) =>
    a.last_name.localeCompare(b.last_name) ||
    a.first_name.localeCompare(b.first_name) ||
    a.email.localeCompare(b.email)
  )
}

export default fetchLDAPContacts
