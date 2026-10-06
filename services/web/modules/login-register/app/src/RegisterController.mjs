import Path from 'path'
import logger from '@overleaf/logger'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import AuthenticationManager from '../../../../app/src/Features/Authentication/AuthenticationManager.mjs'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import HaveIBeenPwned from '../../../../app/src/Features/Authentication/HaveIBeenPwned.mjs'

export default {
  async registerPage(req, res, next) {
    // Check if the user is already logged in
    if (req.user != null) {
      return res.redirect(`/`)
    }

    const showPasswordField = process.env.OVERLEAF_ALLOW_PUBLIC_REGISTRATION === 'true'

    // If not logged in, render the registration page
    const __dirname = Path.dirname(new URL(import.meta.url).pathname)
    res.render(Path.resolve(__dirname, '../views/user/register'), {
      showPasswordField,
      csrfToken: req.csrfToken(),
    })
  },

  // Deal with user registration requests via email
  async registerWithEmail(req, res, next) {
    const { email } = req.body
    if (email == null || email === '') {
      return res.sendStatus(422) // Unprocessable Entity
    }

    // Validate email format before attempting to register the user
    const invalidEmail = AuthenticationManager.validateEmail(email)
    if (invalidEmail) {
      return res.status(400).json({
        message: {
          type: 'error',
          text: invalidEmail.message,
        }
      })
    }

    // If public registration is restricted to a specific email domain,
    // check that the email domain is allowed
    const domain = EmailHelper.getDomain(email)
    if (domain == null || domain !== process.env.OVERLEAF_ALLOW_PUBLIC_REGISTRATION.slice(1)) {
      return res.status(400).json({
        message: 'Email domain not allowed for registration',
      })
    }

    UserRegistrationHandler.registerNewUserAndSendActivationEmail(
      email,
      (error, user, setNewPasswordUrl) => {
        if (error != null) {
          return next(error)
        }
        return res.status(200).json({
          message: 'Registration successful. Please check your email to activate your account.',
        })
      }
    )
  },

  // Deal with user registration requests via username and password
  async registerWithUsernameAndPassword(req, res, next) {
    const { email, password } = req.body
    if (email == null || email === '' || password == null || password === '') {
      return res.sendStatus(422) // Unprocessable Entity
    }

    // Validate email and password format before attempting to register the user
    const invalidEmail = AuthenticationManager.validateEmail(email)
    if (invalidEmail) {
      return res.status(400).json({
        message: {
          type: 'error',
          text: invalidEmail.message,
        }
      })
    }

    const invalidPassword = AuthenticationManager.validatePassword(password, email)
    if (invalidPassword) {
      return res.status(400).json({
        message: {
          type: 'error',
          text: invalidPassword.message,
        }
      })
    }

    // Check if the password has been seen in a data breach before allowing the user to register with it
    let isPasswordReused
    try {
      isPasswordReused = await HaveIBeenPwned.promises.checkPasswordForReuse(password)
    } catch (error) {
      logger.error({ err: error }, 'Error checking password against HaveIBeenPwned')
    }

    if (isPasswordReused) {
      return res.status(400).json({
        message: {
          type: 'error',
          key: 'password-must-be-strong',
          text: 'This password has been seen in a data breach and cannot be used. Please choose a different password.',
        }
      })
    }

    const userDetails = {
      email: email,
      password: password,
      analyticsId: crypto.randomUUID(),
    }

    UserRegistrationHandler.registerNewUser(
      userDetails,
      (error, user) => {
        if (error != null) {
          logger.debug({ err: error }, 'error registering user')
          // Sets like "Email already in use" are communicated back to the client
          return res.status(400).json({
            message: error.message,
          })
        }

        // Registration successful
        return res.json(
          {
            redir: '/login',
          }
        )
      }
    )

  }
}

