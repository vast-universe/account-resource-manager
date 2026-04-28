import "server-only";

import { getDefaultEmailProvider, getEmailProviderApiKey } from "@/lib/email-providers/repository";

export interface MoeMailMessage {
  id: string;
  from: string;
  subject: string;
  content?: string;
  text?: string;
  body?: string;
  html?: string;
  timestamp?: number;
  receivedAt?: string;
}

export interface MoeMailbox {
  id: string;
  email: string;
  password?: string;
  createdAt?: string;
  address?: string;
  userId?: string;
  expiresAt?: string;
}

export interface MoeMailListResponse {
  messages: MoeMailMessage[];
  nextCursor?: string;
}

export interface MoeMailEmailListResponse {
  emails: MoeMailbox[];
  nextCursor?: string;
  total: number;
}

export interface MoeMailDetailResponse {
  message: MoeMailMessage;
}

export interface MoeMailGenerateResponse {
  email: string;
  id: string;
  password?: string;
}

export interface MoeMailConfigResponse {
  defaultRole: string;
  emailDomains: string;
  adminContact: string;
  maxEmails: string;
  turnstile?: {
    enabled: boolean;
    siteKey: string;
    secretKey: string;
  };
}

export interface MoeMailboxListResponse {
  mailboxes: MoeMailbox[];
  total: number;
  nextCursor?: string;
}

class MoeMailClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private getHeaders() {
    return {
      "X-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async listMailboxes(cursor?: string): Promise<MoeMailEmailListResponse> {
    const url = cursor
      ? `${this.apiUrl}/api/emails?cursor=${cursor}`
      : `${this.apiUrl}/api/emails`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MoeMail API error: ${response.status}`);
    }

    return response.json();
  }

  async listMessages(emailId: string, cursor?: string): Promise<MoeMailListResponse> {
    const url = cursor
      ? `${this.apiUrl}/api/emails/${emailId}?cursor=${cursor}`
      : `${this.apiUrl}/api/emails/${emailId}`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MoeMail API error: ${response.status}`);
    }

    return response.json();
  }

  async getMessageDetail(emailId: string, messageId: string): Promise<MoeMailDetailResponse> {
    const response = await fetch(`${this.apiUrl}/api/emails/${emailId}/${messageId}`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MoeMail API error: ${response.status}`);
    }

    return response.json();
  }

  async getConfig(): Promise<MoeMailConfigResponse> {
    const response = await fetch(`${this.apiUrl}/api/config`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MoeMail API error: ${response.status}`);
    }

    return response.json();
  }

  async generateMailbox(domain?: string): Promise<MoeMailGenerateResponse> {
    // Get available domains if not specified
    if (!domain) {
      const config = await this.getConfig();
      const domains = config.emailDomains.split(",").map((d) => d.trim());
      domain = domains[0]; // Use first available domain
    }

    const response = await fetch(`${this.apiUrl}/api/emails/generate`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        expiryTime: 0, // Permanent
        domain: domain,
      }),
      signal: AbortSignal.timeout(30000), // Increase timeout as API is slow
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("MoeMail generate error:", response.status, errorText);
      throw new Error(`MoeMail API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async deleteEmail(emailId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/emails/${emailId}`, {
      method: "DELETE",
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MoeMail API error: ${response.status}`);
    }
  }

  async getAllMessages(emailId: string, maxPages: number = 3): Promise<MoeMailMessage[]> {
    const messages: MoeMailMessage[] = [];
    let cursor: string | undefined;

    for (let i = 0; i < maxPages; i++) {
      const response = await this.listMessages(emailId, cursor);

      if (response.messages && Array.isArray(response.messages)) {
        messages.push(...response.messages);
      }

      cursor = response.nextCursor;
      if (!cursor || !response.messages || response.messages.length === 0) {
        break;
      }
    }

    // 按时间倒序排序
    messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return messages;
  }
}

export async function createMoeMailClient(): Promise<MoeMailClient | null> {
  const provider = await getDefaultEmailProvider("moemail");

  if (!provider) {
    return null;
  }

  const apiKey = await getEmailProviderApiKey(provider.id);

  if (!apiKey) {
    return null;
  }

  return new MoeMailClient(provider.api_url, apiKey);
}

export async function fetchMoeMailboxes(cursor?: string): Promise<MoeMailboxListResponse> {
  const client = await createMoeMailClient();

  if (!client) {
    throw new Error("MoeMail provider not configured");
  }

  const response = await client.listMailboxes(cursor);

  // Transform API response to match expected format
  return {
    mailboxes: response.emails.map((email) => ({
      id: email.id,
      email: email.address || email.email || "",
      createdAt: email.createdAt,
      expiresAt: email.expiresAt,
      userId: email.userId,
    })),
    total: response.total,
    nextCursor: response.nextCursor,
  };
}

export async function fetchMoeMailMessages(emailId: string): Promise<MoeMailMessage[]> {
  const client = await createMoeMailClient();

  if (!client) {
    throw new Error("MoeMail provider not configured");
  }

  return client.getAllMessages(emailId);
}

export async function fetchMoeMailMessageDetail(
  emailId: string,
  messageId: string
): Promise<MoeMailMessage | null> {
  const client = await createMoeMailClient();

  if (!client) {
    throw new Error("MoeMail provider not configured");
  }

  const response = await client.getMessageDetail(emailId, messageId);
  return response.message || null;
}

export async function generateMoeMailbox(): Promise<MoeMailGenerateResponse> {
  const client = await createMoeMailClient();

  if (!client) {
    throw new Error("MoeMail provider not configured");
  }

  return client.generateMailbox();
}
