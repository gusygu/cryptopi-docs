import { sendEmail } from "./email";

function parseList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const ADMIN_RECIPIENTS = parseList(
  process.env.INVITE_ADMIN_EMAILS || process.env.ADMIN_EMAILS || ""
);

export async function notifyAdminsOfInviteRequest(payload: {
  email: string;
  nickname?: string | null;
  note?: string | null;
}) {
  if (!ADMIN_RECIPIENTS.length) return;
  const { email, nickname, note } = payload;
  const subject = `[CryptoPi] Invite request from ${email}`;
  const textLines = [
    `A new invite request was submitted.`,
    `Email: ${email}`,
    nickname ? `Nickname: ${nickname}` : null,
    note ? `Note: ${note}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail({ to: ADMIN_RECIPIENTS, subject, text: textLines });
}

export async function notifyRequesterOfDecision(payload: {
  email: string;
  approved: boolean;
  inviteLink?: string;
}) {
  const subject = payload.approved
    ? "[CryptoPi] Your invite is ready"
    : "[CryptoPi] Invite request update";
  const text = payload.approved
    ? `Your request has been approved.\nInvite link: ${payload.inviteLink ?? "Check with admin"}.`
    : `Unfortunately your invite request was rejected at this time.`;
  await sendEmail({ to: payload.email, subject, text });
}
