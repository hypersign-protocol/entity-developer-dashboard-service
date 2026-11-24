import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { promises as dnsPromises } from 'dns';
import { readFileSync } from 'fs';
import { join } from 'path';
import { domainToASCII } from 'url';
import { redisClient } from 'src/utils/redis.provider';
import { PUBLIC_DNS_RESOLVERS } from '../constants/public-dns-resolvers';

// Community-maintained list (CC0): https://github.com/disposable-email-domains/disposable-email-domains
export const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';
export const BUNDLED_BLOCKLIST_PATH = join(
  __dirname,
  '..',
  'data',
  'disposable_email_blocklist.conf',
);
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// A download smaller than this is treated as broken and ignored.
export const MIN_REMOTE_ENTRIES = 5_000;

const DNS_DEADLINE_MS = 2_000;
const DNS_CACHE_TTL_SECONDS = 24 * 60 * 60;
const DNS_CACHE_PREFIX = 'email-domain:dns:';

// Never blocked and never DNS-checked, even if a bad list update adds them.
export const NEVER_BLOCK = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'zohomail.in',
  'gmx.com',
  'gmx.net',
  'rediffmail.com',
]);

export const DISPOSABLE_EMAIL_ERROR =
  'Please use a permanent email address. Disposable or invalid email domains are not allowed.';

type DnsBlockReason = 'NO_MAIL_ROUTING' | 'RECEIVE_ONLY';
type BlockReason = 'BLOCKLIST' | DnsBlockReason;
type DnsVerdict = 'OK' | DnsBlockReason;
const DNS_VERDICTS: DnsVerdict[] = ['OK', 'NO_MAIL_ROUTING', 'RECEIVE_ONLY'];

export function parseDomainList(text: string): Set<string> {
  const domains = new Set<string>();
  for (const line of text.split('\n')) {
    const domain = line.trim().toLowerCase();
    if (domain && !domain.startsWith('#')) domains.add(domain);
  }
  return domains;
}

/**
 * True when the domain's single SPF record authorises no real sender:
 * `v=spf1 -all`, or only public DNS resolver IPs (`v=spf1 ip4:1.1.1.1 -all`).
 * No SPF, several SPF records (invalid) or anything else returns false.
 */
export function isReceiveOnlySpf(txtRecords: string[]): boolean {
  const spf = txtRecords
    .map((record) => record.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((record) => /^v=spf1(?: |$)/.test(record));
  if (spf.length !== 1) return false;
  const terms = spf[0].split(' ').slice(1);
  if (terms[terms.length - 1] !== '-all') return false;
  return terms.slice(0, -1).every((term) => {
    const ip = term.match(/^\+?ip4:([\d.]+)(?:\/32)?$/)?.[1];
    return !!ip && PUBLIC_DNS_RESOLVERS.has(ip);
  });
}

/**
 * Blocks sign-in with disposable or undeliverable email domains.
 *
 * 1. Blocklist: bundled copy loaded at startup, refreshed from GitHub daily.
 * 2. DNS (optional): blocks when the domain definitively has no mail routing
 *    (NXDOMAIN, null MX, or no MX/A/AAAA), or is receive-only (its SPF
 *    authorises no sender). Any DNS error or timeout allows the request;
 *    the OTP itself proves the mailbox works.
 */
@Injectable()
export class DisposableEmailService
  implements OnModuleInit, OnApplicationShutdown
{
  private blocklist = new Set<string>();
  private refreshTimer?: NodeJS.Timeout;
  private readonly resolver = new dnsPromises.Resolver({
    timeout: 1_000,
    tries: 2,
  });

  onModuleInit() {
    this.loadBundledList();
    // Not awaited: GitHub being slow or down must not hold up startup.
    void this.refreshFromRemote();
    this.refreshTimer = setInterval(
      () => void this.refreshFromRemote(),
      REFRESH_EVERY_MS,
    );
    this.refreshTimer.unref();
  }

  onApplicationShutdown() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  loadBundledList() {
    try {
      this.blocklist = parseDomainList(
        readFileSync(BUNDLED_BLOCKLIST_PATH, 'utf-8'),
      );
      Logger.log(
        `Loaded ${this.blocklist.size} bundled disposable email domains`,
        'DisposableEmailService',
      );
    } catch (error) {
      Logger.error(
        `Could not load bundled disposable email list: ${error?.message}`,
        'DisposableEmailService',
      );
    }
  }

  async refreshFromRemote(): Promise<boolean> {
    try {
      const response = await fetch(BLOCKLIST_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const domains = parseDomainList(await response.text());
      if (domains.size < MIN_REMOTE_ENTRIES) {
        throw new Error(`only ${domains.size} entries, keeping current list`);
      }
      this.blocklist = domains;
      Logger.log(
        `Refreshed disposable email list: ${domains.size} domains`,
        'DisposableEmailService',
      );
      return true;
    } catch (error) {
      Logger.warn(
        `Disposable email list refresh failed: ${error?.message}`,
        'DisposableEmailService',
      );
      return false;
    }
  }

  /** True when the domain or any parent domain is on the blocklist. */
  isBlocklisted(domain: string): boolean {
    const parts = domain.split('.');
    // Stop before the bare TLD.
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      if (NEVER_BLOCK.has(candidate)) return false;
      if (this.blocklist.has(candidate)) return true;
    }
    return false;
  }

  /**
   * Throws BadRequestException when the email must not be used to sign in.
   * `checkDns` adds the mail-routing and receive-only checks (network,
   * cached per domain).
   */
  async assertAllowed(
    email: string,
    { checkDns }: { checkDns: boolean },
  ): Promise<void> {
    const domain = this.extractDomain(email);
    if (!domain) {
      throw new BadRequestException([DISPOSABLE_EMAIL_ERROR]);
    }
    if (NEVER_BLOCK.has(domain)) return;

    let reason: BlockReason | null = null;
    if (this.isBlocklisted(domain)) {
      reason = 'BLOCKLIST';
    } else if (checkDns) {
      reason = await this.checkDomainMail(domain);
    }
    if (reason) {
      // Domain only: the full address is personal data.
      Logger.warn(
        `Blocked sign-in email domain ${domain} (${reason})`,
        'DisposableEmailService',
      );
      throw new BadRequestException([DISPOSABLE_EMAIL_ERROR]);
    }
  }

  private extractDomain(email: string): string | null {
    if (typeof email !== 'string') return null;
    const at = email.lastIndexOf('@');
    if (at < 1) return null;
    const domain = domainToASCII(
      email
        .slice(at + 1)
        .trim()
        .toLowerCase()
        .replace(/\.$/, ''),
    );
    return domain && domain.includes('.') ? domain : null;
  }

  /**
   * The DNS reason to block the domain, or null to allow it. Cached per
   * domain. Fails open: any error or timeout returns null, uncached.
   */
  async checkDomainMail(domain: string): Promise<DnsBlockReason | null> {
    const cacheKey = DNS_CACHE_PREFIX + domain;
    try {
      const cached = (await redisClient.get(cacheKey)) as DnsVerdict | null;
      if (cached && DNS_VERDICTS.includes(cached)) {
        return cached === 'OK' ? null : cached;
      }
    } catch {
      // Redis down: fall through to a live lookup.
    }

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DNS_DEADLINE_MS);
    });
    // null = inconclusive; not cached.
    const verdict = await Promise.race([
      this.lookupDomainMail(domain),
      deadline,
    ]);
    clearTimeout(timer);
    if (verdict === null) return null;

    try {
      await redisClient.set(cacheKey, verdict, 'EX', DNS_CACHE_TTL_SECONDS);
    } catch {
      // Caching is best effort.
    }
    return verdict === 'OK' ? null : verdict;
  }

  /** null = inconclusive. */
  private async lookupDomainMail(domain: string): Promise<DnsVerdict | null> {
    // TXT (for SPF) in parallel with MX: only used when mail routing exists.
    const txtLookup = this.resolver
      .resolveTxt(domain)
      .then((records) => records.map((chunks) => chunks.join('')))
      .catch(() => [] as string[]);

    const routing = await this.lookupMailRouting(domain);
    if (routing !== 'OK') return routing;
    return isReceiveOnlySpf(await txtLookup) ? 'RECEIVE_ONLY' : 'OK';
  }

  private async lookupMailRouting(
    domain: string,
  ): Promise<'OK' | 'NO_MAIL_ROUTING' | null> {
    let mx: { exchange: string; priority: number }[];
    try {
      mx = await this.resolver.resolveMx(domain);
    } catch (error) {
      if (error?.code === 'ENOTFOUND') return 'NO_MAIL_ROUTING'; // no such domain
      if (error?.code !== 'ENODATA') return null;
      mx = [];
    }

    // RFC 7505 null MX: the domain accepts no mail.
    if (mx.length === 1 && ['', '.'].includes(mx[0].exchange)) {
      return 'NO_MAIL_ROUTING';
    }
    if (mx.some((record) => record.exchange && record.exchange !== '.')) {
      return 'OK';
    }

    // No MX: mail falls back to the domain's A/AAAA records.
    const [ipv4, ipv6] = await Promise.allSettled([
      this.resolver.resolve4(domain),
      this.resolver.resolve6(domain),
    ]);
    const hasAddress = (result: PromiseSettledResult<string[]>) =>
      result.status === 'fulfilled' && result.value.length > 0;
    if (hasAddress(ipv4) || hasAddress(ipv6)) return 'OK';

    const definitelyNone = (result: PromiseSettledResult<string[]>) =>
      result.status === 'fulfilled' ||
      ['ENODATA', 'ENOTFOUND'].includes(result.reason?.code);
    return definitelyNone(ipv4) && definitelyNone(ipv6)
      ? 'NO_MAIL_ROUTING'
      : null;
  }
}
