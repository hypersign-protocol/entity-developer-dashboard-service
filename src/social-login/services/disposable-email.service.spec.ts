import { BadRequestException } from '@nestjs/common';
import { redisClient } from 'src/utils/redis.provider';
import {
  DisposableEmailService,
  isReceiveOnlySpf,
  MIN_REMOTE_ENTRIES,
  parseDomainList,
} from './disposable-email.service';

jest.mock('src/utils/redis.provider', () => ({
  redisClient: { get: jest.fn(), set: jest.fn() },
}));

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe('DisposableEmailService', () => {
  let service: DisposableEmailService;
  let resolver: {
    resolveMx: jest.Mock;
    resolve4: jest.Mock;
    resolve6: jest.Mock;
    resolveTxt: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (redisClient.get as jest.Mock).mockResolvedValue(null);
    (redisClient.set as jest.Mock).mockResolvedValue('OK');
    service = new DisposableEmailService();
    service.loadBundledList();
    resolver = {
      resolveMx: jest
        .fn()
        .mockResolvedValue([{ exchange: 'mx.acme.com', priority: 10 }]),
      resolve4: jest.fn().mockRejectedValue(dnsError('ENODATA')),
      resolve6: jest.fn().mockRejectedValue(dnsError('ENODATA')),
      resolveTxt: jest
        .fn()
        .mockResolvedValue([['v=spf1 include:_spf.google.com ~all']]),
    };
    (service as any).resolver = resolver;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('blocklist', () => {
    it('loads the bundled list', () => {
      expect((service as any).blocklist.size).toBeGreaterThan(
        MIN_REMOTE_ENTRIES,
      );
    });

    it.each([
      'foo@mailinator.com',
      'foo@YOPMAIL.com',
      'foo@sub.mailinator.com',
      'foo@mailinator.com.',
    ])('blocks %s', async (email) => {
      await expect(
        service.assertAllowed(email, { checkDns: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['foo@gmail.com', 'foo@acme.com', 'foo@mail.acme.co.in'])(
      'allows %s',
      async (email) => {
        await expect(
          service.assertAllowed(email, { checkDns: false }),
        ).resolves.toBeUndefined();
      },
    );

    it('never blocks major providers, even if the list adds them', async () => {
      (service as any).blocklist.add('gmail.com');
      await expect(
        service.assertAllowed('foo@gmail.com', { checkDns: true }),
      ).resolves.toBeUndefined();
      expect(resolver.resolveMx).not.toHaveBeenCalled();
    });

    it('does not block a TLD on its own', () => {
      (service as any).blocklist.add('com');
      expect(service.isBlocklisted('acme.com')).toBe(false);
    });

    it('rejects addresses with no usable domain', async () => {
      await expect(
        service.assertAllowed('foo@localhost', { checkDns: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('parses lists, skipping blanks and comments', () => {
      expect([...parseDomainList('a.com\n\n# note\n B.COM \r\n')]).toEqual([
        'a.com',
        'b.com',
      ]);
    });
  });

  describe('remote refresh', () => {
    it('replaces the list with a valid download', async () => {
      const big = Array.from(
        { length: MIN_REMOTE_ENTRIES },
        (_, i) => `d${i}.test`,
      ).join('\n');
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(big + '\nnew-temp.io'));
      await expect(service.refreshFromRemote()).resolves.toBe(true);
      expect(service.isBlocklisted('new-temp.io')).toBe(true);
    });

    it('keeps the current list when the download is truncated', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('a.com\n'));
      await expect(service.refreshFromRemote()).resolves.toBe(false);
      expect(service.isBlocklisted('mailinator.com')).toBe(true);
    });

    it('keeps the current list when GitHub fails', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('', { status: 503 }));
      await expect(service.refreshFromRemote()).resolves.toBe(false);
      expect(service.isBlocklisted('mailinator.com')).toBe(true);
    });
  });

  describe('mail routing (DNS)', () => {
    it('allows a domain with MX records and caches the result', async () => {
      await expect(
        service.assertAllowed('foo@acme.com', { checkDns: true }),
      ).resolves.toBeUndefined();
      expect(redisClient.set).toHaveBeenCalledWith(
        'email-domain:dns:acme.com',
        'OK',
        'EX',
        expect.any(Number),
      );
    });

    it('blocks a domain that does not exist', async () => {
      resolver.resolveMx.mockRejectedValue(dnsError('ENOTFOUND'));
      await expect(
        service.assertAllowed('foo@no-such-domain-xyz.com', { checkDns: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks a null MX domain', async () => {
      resolver.resolveMx.mockResolvedValue([{ exchange: '', priority: 0 }]);
      await expect(service.checkDomainMail('acme.com')).resolves.toBe(
        'NO_MAIL_ROUTING',
      );
    });

    it('blocks no MX and no A/AAAA', async () => {
      resolver.resolveMx.mockRejectedValue(dnsError('ENODATA'));
      await expect(service.checkDomainMail('acme.com')).resolves.toBe(
        'NO_MAIL_ROUTING',
      );
    });

    it('allows no MX when an A record exists (implicit MX)', async () => {
      resolver.resolveMx.mockRejectedValue(dnsError('ENODATA'));
      resolver.resolve4.mockResolvedValue(['203.0.113.5']);
      await expect(service.checkDomainMail('acme.com')).resolves.toBeNull();
    });

    it('fails open, uncached, on DNS server errors', async () => {
      resolver.resolveMx.mockRejectedValue(dnsError('ESERVFAIL'));
      await expect(service.checkDomainMail('acme.com')).resolves.toBeNull();
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('fails open, uncached, when DNS exceeds the deadline', async () => {
      jest.useFakeTimers();
      resolver.resolveMx.mockReturnValue(new Promise(() => undefined));
      const result = service.checkDomainMail('slow.example');
      // Let the Redis cache read settle so the deadline timer is set.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      jest.advanceTimersByTime(2_500);
      await expect(result).resolves.toBeNull();
      expect(redisClient.set).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('uses the cached verdict without a lookup', async () => {
      (redisClient.get as jest.Mock).mockResolvedValue('NO_MAIL_ROUTING');
      await expect(service.checkDomainMail('acme.com')).resolves.toBe(
        'NO_MAIL_ROUTING',
      );
      expect(resolver.resolveMx).not.toHaveBeenCalled();
    });

    it('falls back to a live lookup when Redis is down', async () => {
      (redisClient.get as jest.Mock).mockRejectedValue(new Error('down'));
      (redisClient.set as jest.Mock).mockRejectedValue(new Error('down'));
      await expect(service.checkDomainMail('acme.com')).resolves.toBeNull();
    });
    it('blocks a receive-only domain (SPF authorises no sender)', async () => {
      resolver.resolveTxt.mockResolvedValue([['v=spf1 -all']]);
      await expect(
        service.assertAllowed('foo@acme.com', { checkDns: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(redisClient.set).toHaveBeenCalledWith(
        'email-domain:dns:acme.com',
        'RECEIVE_ONLY',
        'EX',
        expect.any(Number),
      );
    });

    it('checks SPF for implicit-MX domains too', async () => {
      resolver.resolveMx.mockRejectedValue(dnsError('ENODATA'));
      resolver.resolve4.mockResolvedValue(['203.0.113.5']);
      resolver.resolveTxt.mockResolvedValue([['v=spf1 ip4:', '1.1.1.1 -all']]);
      await expect(service.checkDomainMail('acme.com')).resolves.toBe(
        'RECEIVE_ONLY',
      );
    });

    it('allows the domain when the TXT lookup fails', async () => {
      resolver.resolveTxt.mockRejectedValue(dnsError('ETIMEOUT'));
      await expect(service.checkDomainMail('acme.com')).resolves.toBeNull();
    });

    it('ignores a cached value it does not recognise', async () => {
      (redisClient.get as jest.Mock).mockResolvedValue('1');
      await expect(service.checkDomainMail('acme.com')).resolves.toBeNull();
      expect(resolver.resolveMx).toHaveBeenCalled();
    });
  });

  describe('isReceiveOnlySpf', () => {
    it.each([
      [['v=spf1 -all']],
      [['V=SPF1   -ALL']],
      [['v=spf1 ip4:1.1.1.1 -all']],
      [['v=spf1 +ip4:8.8.8.8/32 ip4:1.0.0.1 -all']],
      [['google-site-verification=x', 'v=spf1 -all']],
    ])('receive-only: %j', (records) => {
      expect(isReceiveOnlySpf(records)).toBe(true);
    });

    it.each([
      [[]],
      [['v=spf1 include:_spf.google.com -all']],
      [['v=spf1 ip4:203.0.113.5 -all']],
      [['v=spf1 ip4:1.1.1.1 ip4:203.0.113.5 -all']],
      [['v=spf1 ~all']],
      [['v=spf1 ip4:1.1.1.1/24 -all']],
      [['v=spf1 -all', 'v=spf1 -all']],
      [['v=spf1 redirect=_spf.acme.com']],
    ])('not receive-only: %j', (records) => {
      expect(isReceiveOnlySpf(records)).toBe(false);
    });
  });
});
