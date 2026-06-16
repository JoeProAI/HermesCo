/**
 * Email utility -- sends from clawd.run via Resend.
 * From: Jobeous <jobeous@clawd.run>
 */
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");

export const FROM = "Jobeous <jobeous@clawd.run>";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<string> {
  const { data, error } = await resend.emails.send({
    from: opts.from ?? FROM,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? textToHtml(opts.text),
    replyTo: opts.replyTo,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return data!.id;
}

function textToHtml(text: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;color:#111;max-width:560px;margin:40px auto;padding:0 20px;line-height:1.6">
${text
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n")}
<hr style="margin:32px 0;border:none;border-top:1px solid #eee">
<p style="font-size:12px;color:#888">Sent via <a href="https://clawd.run" style="color:#6366f1">clawd.run</a></p>
</body>
</html>`;
}
