const emailChangeOtpTemplate = ({ otp, newEmail, expiryMinutes = 10 }) => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F6F8FB;font-family:'Inter',system-ui,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FB;padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:18px;border:1px solid #E9EDF2;overflow:hidden;">

            <tr>
              <td style="padding:32px 36px 0;">
                <span style="font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:20px;letter-spacing:-.02em;">
                  <span style="color:#2563EB;">Clinic</span><span style="color:#17A768;">Flow</span>
                </span>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 36px 8px;">
                <h1 style="margin:0;font-family:'Bricolage Grotesque',sans-serif;font-size:22px;font-weight:700;color:#0F172A;">
                  Confirm your new email
                </h1>
                <p style="margin:12px 0 0;font-size:14.5px;line-height:1.6;color:#64748B;">
                  We received a request to change the email on your ClinicFlow account to
                  <strong style="color:#0F172A;">${newEmail}</strong>.
                  Enter the code below to confirm it's you.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 36px;">
                <div style="background:#F2F6FF;border:1px solid #EAF1FF;border-radius:14px;padding:22px;text-align:center;">
                  <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#94A3B8;margin-bottom:10px;">
                    Verification code
                  </div>
                  <div style="font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:34px;letter-spacing:.12em;color:#2563EB;">
                    ${otp}
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 36px 32px;">
                <p style="margin:0;font-size:13.5px;color:#94A3B8;line-height:1.6;">
                  This code expires in ${expiryMinutes} minutes. If you didn't request this change,
                  you can safely ignore this email — your account email will stay the same.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 36px;border-top:1px solid #E9EDF2;">
                <p style="margin:0;font-size:12px;color:#94A3B8;">
                  ClinicFlow will never ask you for this code by phone or chat.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

export { emailChangeOtpTemplate };