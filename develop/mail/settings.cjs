// OVERLEAF_EMAIL_* is only read by server-ce/config/settings.js, which the dev
// env does not load, so the SMTP settings for Mailpit are set here.
module.exports = {
  email: {
    fromAddress: 'overleaf@example.com',
    replyTo: '',
    parameters: {
      host: 'mailpit',
      port: 1025,
      ignoreTLS: true,
    },
  },
  // The inbox in the Dev tools menu of the navbar, see settings.dev-env.cjs
  devTools: {
    mailpit: { text: 'Mailpit', url: '/mailpit/' },
  },
}
