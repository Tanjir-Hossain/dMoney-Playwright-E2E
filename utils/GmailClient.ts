import { APIRequestContext, expect } from '@playwright/test';

// Load GMAIL_ACCESS_TOKEN from the local .env file.
process.loadEnvFile('.env');

const GMAIL_API =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages';

type GmailHeader = { name: string; value: string };

type GmailMessagePart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  internalDate: string;
  snippet?: string;
  payload?: GmailMessagePart;
};

/**
 * Thin read-only Gmail REST client used to pull the DMoney login OTP and
 * the password-reset link out of the configured test mailbox.
 *
 * Authentication is a bearer OAuth access token (GMAIL_ACCESS_TOKEN).
 */
export class GmailClient {
  private readonly headers = {
    Authorization: `Bearer ${process.env.GMAIL_ACCESS_TOKEN}`,
  };

  constructor(private readonly request: APIRequestContext) {}

  /**
   * Snapshot the message IDs currently in the mailbox for `recipient`.
   * Capture this right before an action that triggers an email, then pass
   * it to `waitForOtp` / `waitForResetLink` so only a genuinely NEW message
   * is considered. This avoids any reliance on timestamps, which Gmail only
   * records to whole-second precision and which race with the local clock.
   */
  async snapshotMessageIds(recipient: string): Promise<Set<string>> {
    const messages = await this.listMessages(
      `to:${recipient} newer_than:1d`
    );
    return new Set(messages.map((m) => m.id));
  }

  // ---------------------------------------------------------------------
  // Login OTP
  // ---------------------------------------------------------------------

  /** Poll until a NEW 4-digit OTP email (not in `knownIds`) arrives. */
  async waitForOtp(
    knownIds: Set<string>,
    recipient: string,
    timeoutMs = 180_000,
    intervalMs = 3_000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const otp = await this.findNewOtp(knownIds, recipient);
      if (otp) {
        return otp;
      }
      await this.delay(intervalMs);
    }

    throw new Error(
      `No new DMoney OTP received for ${recipient} within ${
        timeoutMs / 1000
      }s`
    );
  }

  private async findNewOtp(
    knownIds: Set<string>,
    recipient: string
  ): Promise<string | null> {
    const messages = await this.listMessages(
      `to:${recipient} newer_than:1d`
    );

    for (const { id } of messages) {
      if (knownIds.has(id)) {
        continue;
      }

      const mail = await this.getMessage(id);

      const to = this.getHeader(mail, 'To');
      if (!to.toLowerCase().includes(recipient.toLowerCase())) {
        continue;
      }

      const text = [
        mail.snippet ?? '',
        this.extractMessageBody(mail.payload),
      ].join('\n');

      // Prefer the digits after "OTP ... is:" and fall back to any
      // standalone 4-digit group (avoids matching the agent timestamp).
      const otp =
        text.match(/OTP[^0-9]{0,40}(\d{4})\b/i)?.[1] ??
        text.match(/\b\d{4}\b/)?.[0];
      if (otp) {
        console.log('New OTP email found:', id);
        return otp;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------
  // Password reset link
  // ---------------------------------------------------------------------

  /** Poll until a NEW password-reset email arrives, returning its URL. */
  async waitForResetLink(
    knownIds: Set<string>,
    recipient: string,
    timeoutMs = 120_000,
    intervalMs = 3_000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    console.log('Waiting for password-reset email:', recipient);

    while (Date.now() < deadline) {
      const resetLink = await this.findNewResetLink(knownIds, recipient);
      if (resetLink) {
        console.log('Password-reset link email found');
        return resetLink;
      }
      await this.delay(intervalMs);
    }

    throw new Error(
      `No password-reset email received for ${recipient} within ${
        timeoutMs / 1000
      }s`
    );
  }

  private async findNewResetLink(
    knownIds: Set<string>,
    recipient: string
  ): Promise<string | null> {
    const messages = await this.listMessages(
      `to:${recipient} newer_than:1d`
    );

    for (const { id } of messages) {
      if (knownIds.has(id)) {
        continue;
      }

      const mail = await this.getMessage(id);

      const to = this.getHeader(mail, 'To');
      if (!to.toLowerCase().includes(recipient.toLowerCase())) {
        continue;
      }

      const subject = this.getHeader(mail, 'Subject');
      if (!/reset|password|forgot/i.test(subject)) {
        continue;
      }

      const body = this.extractMessageBody(mail.payload);
      const resetLink = this.extractResetLink(body);
      if (resetLink) {
        console.log('Reset link extracted from:', subject);
        return resetLink;
      }
    }

    return null;
  }

  private extractResetLink(text: string): string | null {
    // Decode the HTML entities commonly found in email bodies.
    const decoded = text
      .replace(/&amp;/gi, '&')
      .replace(/&#x3D;/gi, '=')
      .replace(/&#61;/gi, '=');

    const urls = decoded.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const url of urls) {
      const cleaned = url.replace(/[),.;]+$/, '');
      if (/reset|password|token|forgot/i.test(cleaned)) {
        return cleaned;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------
  // Gmail REST helpers
  // ---------------------------------------------------------------------

  private async listMessages(
    query: string
  ): Promise<Array<{ id: string }>> {
    const response = await this.request.get(GMAIL_API, {
      headers: this.headers,
      params: { maxResults: 20, q: query },
    });

    expect(response.status(), await response.text()).toBe(200);

    const data = await response.json();
    return data.messages ?? [];
  }

  private async getMessage(id: string): Promise<GmailMessage> {
    const response = await this.request.get(`${GMAIL_API}/${id}`, {
      headers: this.headers,
      params: { format: 'full' },
    });

    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as GmailMessage;
  }

  private getHeader(mail: GmailMessage, name: string): string {
    const header = mail.payload?.headers?.find(
      (item) => item.name.toLowerCase() === name.toLowerCase()
    );
    return header?.value ?? '';
  }

  /** Recursively decode base64url message parts into a single string. */
  private extractMessageBody(payload?: GmailMessagePart): string {
    if (!payload) {
      return '';
    }

    const chunks: string[] = [];

    if (payload.body?.data) {
      const base64 = payload.body.data
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      chunks.push(Buffer.from(base64, 'base64').toString('utf8'));
    }

    for (const part of payload.parts ?? []) {
      chunks.push(this.extractMessageBody(part));
    }

    return chunks.join('\n');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
