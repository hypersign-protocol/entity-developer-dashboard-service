import creditRequest from './credit-request.template';
import creditUsage from './credit-usage-alert.template';
import emailOtp from './email-otp.template';
import onboardingApprove from './onboarding-approve.template';
import retryOnboarding from './request-retry-onboarding';

import * as fs from 'fs';
import * as path from 'path';

function writePreview(name: string, html: string) {
  const dir = path.resolve(process.cwd(), 'tmp', 'email-previews');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${name}.html`);
  fs.writeFileSync(dest, html, 'utf8');
}

describe('mail templates render', () => {
  it('renders all templates to HTML without throwing', () => {
    const errors: Array<{ name: string; error: any }> = [];

    try {
      const html = creditRequest(
        'user-1',
        'req@example.com',
        'svc',
        'onb-1',
        'Example Co',
        'standard',
        'req@example.com',
        'tw',
        'tg',
      );
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(20);
      writePreview('credit-request', html);
    } catch (e) {
      errors.push({ name: 'credit-request', error: e });
    }

    try {
      const html = creditUsage('svc-1', 85, 80, 1000, 850, new Date().toISOString());
      expect(typeof html).toBe('string');
      writePreview('credit-usage-alert', html);
    } catch (e) {
      errors.push({ name: 'credit-usage-alert', error: e });
    }

    try {
      const html = emailOtp('123456', 5, 'OTP');
      expect(typeof html).toBe('string');
      writePreview('email-otp', html);
    } catch (e) {
      errors.push({ name: 'email-otp', error: e });
    }

    try {
      const html = onboardingApprove('Alice');
      expect(typeof html).toBe('string');
      writePreview('onboarding-approve', html);
    } catch (e) {
      errors.push({ name: 'onboarding-approve', error: e });
    }

    try {
      const html = retryOnboarding('user-2', 'req2@example.com', 'step-1', 'network error', 'onb-2');
      expect(typeof html).toBe('string');
      writePreview('request-retry-onboarding', html);
    } catch (e) {
      errors.push({ name: 'request-retry-onboarding', error: e });
    }

    if (errors.length > 0) {
      // print full error stacks for debugging
      // eslint-disable-next-line no-console
      console.error('Template render errors:', errors.map((e) => ({ name: e.name, message: e.error && e.error.message, stack: e.error && e.error.stack })));
    }

    expect(errors.length).toBe(0);
  });
});
