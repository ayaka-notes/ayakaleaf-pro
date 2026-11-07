// rate limit email system expects an email format.
// We need to prepare the login for rate limit email by appending a domain to it.
export function prepareLdapLoginForRateLimitEmail(field = 'email') {
  return function (req, res, next) {
    const value = req.body[field]
    if (!value) return next()

    if (!value.includes('@')) {
      req._originalLogin = value
      req.body[field] = `${value}@ldap-fake.localhost`
    }

    next()
  }
}

export function restoreLdapLoginAfterRateLimitEmail(field = 'email') {
  return function (req, res, next) {
    if (req._originalLogin !== undefined) {
      req.body[field] = req._originalLogin
      delete req._originalLogin
    }
    next()
  }
}
