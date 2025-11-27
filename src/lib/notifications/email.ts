import * as Brevo from "@getbrevo/brevo";

type EmailPayload = {
  to: string | string[];
  subject: string;
  text: string;
};

function normalizeRecipients(to: string | string[]): string[] {
  if (Array.isArray(to)) {
    return to.map((entry) => entry.trim()).filter(Boolean);
  }
  return to
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseFromAddress() {
  const fromEnv =
    process.env.MAIL_FROM || process.env.BREVO_SENDER || process.env.SMTP_USER;
  if (!fromEnv) {
    return { email: "no-reply@localhost", name: "CryptoPi Dynamics" };
  }
  const match = fromEnv.match(/(.*)<(.+)>/);
  if (match) {
    return { email: match[2].trim(), name: match[1].trim() || undefined };
  }
  return { email: fromEnv.trim(), name: "CryptoPi Dynamics" };
}

const brevoClient = new Brevo.TransactionalEmailsApi();
const brevoApiKey = process.env.BREVO_API_KEY || "";
if (brevoApiKey) {
  brevoClient.setApiKey(
    Brevo.TransactionalEmailsApiApiKeys.apiKey,
    brevoApiKey
  );
}

/**
 * Sends transactional emails through Brevo. Falls back to console logging if
 * no API key is configured to keep dev environments functional.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const recipients = normalizeRecipients(payload.to);
  if (!recipients.length) {
    console.info("[mail] skipped (no recipients)", payload.subject);
    return;
  }

  if (!brevoApiKey) {
    console.info(
      `[mail] (dry run) to=${recipients.join(", ")} | subject=${
        payload.subject
      }\n${payload.text}`
    );
    return;
  }

  const sender = parseFromAddress();

  try {
    await brevoClient.sendTransacEmail({
      sender,
      to: recipients.map((email) => ({ email })),
      subject: payload.subject,
      textContent: payload.text,
    });
  } catch (err) {
    console.error("[mail] Brevo send failed", err);
  }
}
