// Password reset codes are delivered here.
//
// No email or SMS provider is connected yet, so in development the code is printed in the
// server console. To send real messages, replace the body of deliverResetCode with a call to
// your provider (nodemailer, Semaphore SMS, Twilio, etc.).

async function deliverResetCode(user, code) {
  console.log(`\n[password reset] ${user.full_name} (${user.email || user.username}) -> code ${code} (valid 15 minutes)\n`);
}

module.exports = { deliverResetCode };
