// Maestro script: reads the newest password-recovery email for E2E_EMAIL from the
// isolated test inbox (the E2E stack's SMTP sink, loopback only) and returns its code as
// output.code. It is how the native flow gets the code the app asked the server to
// email: there is no test hook in the app or the server, and no shortcut around the
// server's own check of the code.
var response = http.get(MAIL_API + '/messages');
var messages = JSON.parse(response.body);
var found = null;
for (var i = messages.length - 1; i >= 0; i--) {
  var mail = messages[i];
  if (mail.to.indexOf(E2E_EMAIL) !== -1 && mail.subject.indexOf('reset code') !== -1) {
    found = mail;
    break;
  }
}
if (found === null) {
  throw new Error('no recovery email for the test account in the test inbox');
}
var match = /\b(\d{4}) (\d{4})\b/.exec(found.body);
if (match === null) {
  throw new Error('the recovery email has no code');
}
output.code = match[1] + match[2];
