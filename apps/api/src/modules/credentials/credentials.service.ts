import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { prisma } from '@auto-post/db';
import { decryptJson } from '@auto-post/crypto';

const TICKET_TTL_MS = 60_000;

interface TicketEntry {
  accountId: string;
  expiresAt: number;
}

@Injectable()
export class CredentialsService {
  private tickets = new Map<string, TicketEntry>();

  issueTicket(accountId: string): string {
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { accountId, expiresAt: Date.now() + TICKET_TTL_MS });
    this.gc();
    return ticket;
  }

  async exchange(ticket: string): Promise<Record<string, unknown>> {
    const entry = this.tickets.get(ticket);
    if (!entry) throw new Error('ticket not found');
    this.tickets.delete(ticket);
    if (Date.now() > entry.expiresAt) throw new Error('ticket expired');

    const credential = await prisma.accountCredential.findUnique({
      where: { accountId: entry.accountId },
    });
    if (!credential) throw new Error('credential not found');
    return decryptJson<Record<string, unknown>>(Buffer.from(credential.ciphertext).toString('base64'));
  }

  private gc() {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
