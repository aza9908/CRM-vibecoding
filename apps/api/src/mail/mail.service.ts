import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Transactional email.
 *
 * Deliberately provider-agnostic: it posts to a generic SMTP-over-HTTP style
 * endpoint described by env vars, so swapping Resend / Postmark / SendGrid is a
 * config change rather than a code change.
 *
 * When no provider is configured (local dev, CI, first deploy) it does NOT
 * throw — it logs the message and, for reset links, prints the URL to the
 * server console so the flow stays testable end to end. That keeps password
 * recovery usable before the mail provider is wired up.
 */

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly endpoint?: string;
  private readonly apiKey?: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.endpoint = config.get<string>('MAIL_API_URL');
    this.apiKey = config.get<string>('MAIL_API_KEY');
    this.from =
      config.get<string>('MAIL_FROM') ?? 'AIRL LMS <no-reply@airl.kz>';
  }

  /** True when a real provider is configured. */
  get enabled(): boolean {
    return Boolean(this.endpoint && this.apiKey);
  }

  /**
   * Send a message. Never throws — a mail outage must not turn into a 500 on
   * the password-reset endpoint, which would also leak that the address exists.
   */
  async send(input: SendMailInput): Promise<boolean> {
    if (!this.enabled) {
      this.logger.warn(
        `MAIL NOT CONFIGURED — would have sent "${input.subject}" to ${input.to}`,
      );
      this.logger.debug(input.text);
      return false;
    }

    try {
      const res = await fetch(this.endpoint as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      });

      if (!res.ok) {
        this.logger.error(
          `mail provider returned ${res.status} for ${input.subject}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error('mail send failed', err as Error);
      return false;
    }
  }

  /**
   * Password reset email. Trilingual header line because the platform ships
   * ru / kk / en and we do not know the recipient's UI locale at request time.
   */
  async sendPasswordReset(
    to: string,
    resetUrl: string,
    ttlMinutes: number,
  ): Promise<boolean> {
    const subject = 'Восстановление пароля · Құпиясөзді қалпына келтіру';

    const text = [
      'Восстановление пароля',
      '',
      `Откройте ссылку, чтобы задать новый пароль (действительна ${ttlMinutes} минут):`,
      resetUrl,
      '',
      'Если вы не запрашивали смену пароля — просто проигнорируйте это письмо.',
      '',
      '—',
      `Open this link to set a new password (valid for ${ttlMinutes} minutes):`,
      resetUrl,
    ].join('\n');

    const html = `<!doctype html>
<html><body style="margin:0;padding:32px;background:#f6f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#16161a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:36px">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:600">Восстановление пароля</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#5c5c6b">
            Нажмите кнопку ниже, чтобы задать новый пароль.
            Ссылка действительна ${ttlMinutes} минут и работает один раз.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;background:#16161a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:15px;font-weight:500">
            Задать новый пароль
          </a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8a8a99">
            Если кнопка не работает, скопируйте адрес в браузер:<br>
            <span style="word-break:break-all;color:#5c5c6b">${resetUrl}</span>
          </p>
          <hr style="border:none;border-top:1px solid #ececf1;margin:28px 0">
          <p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a99">
            Если вы не запрашивали смену пароля, просто проигнорируйте это письмо —
            ваш текущий пароль останется прежним.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    return this.send({ to, subject, html, text });
  }
}
