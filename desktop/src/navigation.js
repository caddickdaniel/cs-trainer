// Where a navigation in the CS Trainer window may go.
//
// 'app'      CS Trainer itself.
// 'signin'   Steam's OpenID sign-in pages. They stay in this window so Steam's
//            return to /api/auth/steam/callback lands here, with this window's
//            session. Opened in the system browser instead, the sign-in
//            finishes there and the app stays signed out. These pages never get
//            the hotkey bridge: main.js only answers IPC from the app origin.
// 'external' Anything else: opened in the system browser.
const SIGNIN_ORIGINS = new Set([
  'https://steamcommunity.com', // OpenID endpoint and its sign-in form
  'https://login.steampowered.com', // Steam's account login pages
]);

function navigationTarget(url, appOrigin) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return 'external';
  }
  if (origin === appOrigin) return 'app';
  if (SIGNIN_ORIGINS.has(origin)) return 'signin';
  return 'external';
}

module.exports = { navigationTarget, SIGNIN_ORIGINS };
