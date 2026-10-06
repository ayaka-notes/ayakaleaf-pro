import { rememberExternalAuth } from '../logout.mjs'
let ldapModule = {}
if (process.env.EXTERNAL_AUTH?.includes('ldap')) {
  const { default: LDAPModuleManager } = await import('./app/src/LDAPModuleManager.mjs')
  const { default: router } = await import('./app/src/LDAPRouter.mjs')
  LDAPModuleManager.initSettings()
  LDAPModuleManager.initPolicy()
  ldapModule = {
    name: 'ldap-authentication',
    hooks: {
      preFinishLogin: rememberExternalAuth,
      passportSetup: LDAPModuleManager.passportSetup,
      getContacts: LDAPModuleManager.getContacts,
      getGroupPolicyForUser: LDAPModuleManager.getGroupPolicyForUser,
    },
    router: router,
  }
}
export default ldapModule
