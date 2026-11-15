/**
 * Passport instance capture: the authentication modules register their
 * strategies during the `passportSetup` hook and record the passport
 * instance here, so the admin UI can (re)register strategies live when
 * providers change.
 */

let passportInstance = null

export function setPassport(passport) {
  passportInstance = passport
}

export function getPassport() {
  return passportInstance
}
