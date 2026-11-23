// What the sign-in page and the account form say, and who may open a Mermaid diagram as a new
// slate. Plain functions, so the words are tested without a browser (scripts/no-dead-ends.test.mjs).

// Set once a person has been signed in to an account on this browser: the next sign-in page
// greets them as returning. Storage may be missing or throw (a private window, blocked site data).
export const SIGNED_IN_BEFORE_KEY = 'slatebox.signedInBefore'

export function rememberSignedIn(storage) {
  try { storage?.setItem(SIGNED_IN_BEFORE_KEY, '1') } catch { /* nothing to remember with */ }
}

export function signedInBefore(storage) {
  try { return storage?.getItem(SIGNED_IN_BEFORE_KEY) === '1' } catch { return false }
}

export function loginWelcome(returning) {
  return returning
    ? { heading: 'Welcome back.', lede: 'Sign in to pick up where you left off.' }
    : { heading: 'Sign in to Slatebox', lede: 'New here? Create an account, or start a slate with no account at all.' }
}

// The account form (common/Register.jsx). A guest either chose to sign up (from the sign-in page's
// Create an account) or is saving what they made; a signed-in person verifies their email.
export function registrationCopy({ guest, intent, emailSent = false }) {
  if (guest && intent === 'signup') {
    return {
      heading: 'Create your account',
      lede: 'Add your email and a password. Your slates stay with you on every device.',
      action: 'Create account',
      dismiss: 'Not now',
      // Someone signing up has no slate yet: the line under the email field speaks only of the email.
      emailHelper: 'We’ll send a link to confirm it’s you.',
    }
  }
  if (guest) {
    return {
      heading: 'Save your work',
      lede: 'You’re working as a guest, no account needed. Add an email and a password to keep your slates on every device.',
      action: 'Save my Slatebox',
      dismiss: 'Continue as guest',
      emailHelper: 'We’ll send a verification link. Your slate remains available while you verify.',
    }
  }
  return {
    heading: 'Verify your email',
    lede: null,
    action: emailSent ? 'Resend verification email' : 'Send verification email',
    dismiss: null,
    emailHelper: 'We’ll send a verification link.',
  }
}

// Opening Mermaid as a new slate makes a slate in an account (slates.importMermaid refuses a
// guest). 'open' offers it; 'save' asks a guest to save their work; 'sign-in' asks a visitor to sign in.
export function mermaidNewSlateRoom(user) {
  if (!user) return 'sign-in'
  return user.isAnonymous ? 'save' : 'open'
}

// The note in the Mermaid dialog when a new slate needs an account. It speaks of Add to this slate
// only when that button is there (the person can edit this slate); a guest reading someone else's
// slate hears only the way on.
export function mermaidNewSlateNote(room, canEdit) {
  if (room === 'open') return null
  if (room === 'sign-in') return 'Sign in to open a diagram as a slate of its own.'
  return canEdit
    ? 'Save your work to open a diagram as a slate of its own. Adding it to this slate works as you are.'
    : 'Save your work to open this diagram as a slate of its own.'
}
