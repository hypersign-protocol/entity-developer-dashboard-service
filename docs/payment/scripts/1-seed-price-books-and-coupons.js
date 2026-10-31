// Billing 1: create price book v1 (India and Global) and the FOUNDING coupons.
//
// Run in mongosh (or Compass > MONGOSH) after `use <db>`. Review with DRY_RUN = true first.
// Safe to run again: an existing published price book is left alone, and coupons
// are only inserted, never overwritten (their usage counters are kept).
//
// Indexes are created by the service on start (Mongoose), so start the new build
// once before or after running this; nothing here depends on them.
//
// Prices follow the agreed model (docs/payment/credits-top-up-payment.md §1).
// Money is in minor units (paise, cents); percentages in basis points.
const DRY_RUN = false;
const PUBLISHED_BY = 'seed-script';

// [priceMinor, discountBps]
const IN_TIERS = [[99900, 1000], [249900, 2500], [499900, 2800], [999900, 3500]];
const GL_TIERS = [[9900, 0], [19900, 4000], [29900, 4650], [49900, 5200], [149900, 5500]];

// One PLAN rule per plan, and one AMOUNT_RANGE rule per plan covering custom
// amounts from that plan up to the next one. Plan rules win (higher priority).
function rulesFor(prefix, tiers) {
  const maxMinor = tiers[tiers.length - 1][0];
  return tiers.flatMap(([priceMinor, percentBps], i) => [
    { id: `${prefix}_PLAN_${priceMinor}`, type: 'PLAN', planCode: `${prefix}_${priceMinor / 100}`, percentBps, priority: 10 },
    {
      id: `${prefix}_RANGE_${priceMinor}`,
      type: 'AMOUNT_RANGE',
      minMinor: priceMinor,
      maxMinor: i + 1 < tiers.length ? tiers[i + 1][0] - 1 : maxMinor,
      percentBps,
      priority: 0,
    },
  ]);
}

function plansFor(prefix, tiers) {
  return tiers.map(([priceMinor], i) => ({ code: `${prefix}_${priceMinor / 100}`, priceMinor, displayOrder: i + 1, active: true }));
}

function addOns(validityDays, validityShort, validityText) {
  return [
    { code: 'VALIDITY', title: 'Credit validity', shortTitle: validityShort, description: validityText, icon: 'mdi-calendar-clock', priceMinor: 0, included: true, config: { validityDays } },
    { code: 'HUMAN_SUPPORT_24X7', title: '24×7 human support', shortTitle: '24×7 support', description: 'Talk to our support team at any time.', icon: 'mdi-headset', priceMinor: 0, included: true },
    { code: 'EMAIL_SUPPORT', title: 'Email support', shortTitle: 'Email support', description: 'Get help by email.', icon: 'mdi-email-outline', priceMinor: 0, included: true },
  ];
}

const now = new Date();
const PRICE_BOOKS = [
  {
    region: 'IN',
    currency: 'INR',
    creditsPerMajorUnit: 1,
    custom: { enabled: true, minMinor: IN_TIERS[0][0], maxMinor: IN_TIERS[IN_TIERS.length - 1][0] },
    calculatorFlowIds: ['india'],
    plans: plansFor('IN', IN_TIERS),
    discountRules: rulesFor('IN', IN_TIERS),
    addOns: addOns(30, '1 month validity', 'Credits are valid for 1 month from activation. Unused credits do not carry forward.'),
  },
  {
    region: 'GLOBAL',
    currency: 'USD',
    creditsPerMajorUnit: 90, // to be confirmed by Business (open question 2)
    custom: { enabled: true, minMinor: GL_TIERS[0][0], maxMinor: GL_TIERS[GL_TIERS.length - 1][0] },
    calculatorFlowIds: ['global', 'business'],
    plans: plansFor('GL', GL_TIERS),
    discountRules: rulesFor('GL', GL_TIERS),
    addOns: addOns(180, '6 months validity', 'Credits are valid for 6 months from activation. Unused credits do not carry forward.'),
  },
];

const COUPONS = [
  {
    code: 'FOUNDING15',
    region: 'GLOBAL',
    percentBps: 1500,
    listed: true,
    title: 'Founding customer offer',
    description: '15% off your first 3 top-ups within 6 months of business verification. For the first 500 verified businesses.',
    campaign: 'FOUNDING',
    eligibility: { requiresKybApproved: true, withinDaysOfKybApproval: 180 },
    limits: { maxAccounts: 500, maxRedemptionsPerAccount: 3 },
  },
  {
    code: 'FOUNDING8',
    region: 'IN',
    percentBps: 800,
    listed: true,
    title: 'Founding customer offer',
    description: '8% off your first 3 top-ups within 6 months of business verification. For the first 500 verified Indian businesses with a GSTIN or PAN.',
    campaign: 'FOUNDING',
    eligibility: { requiresKybApproved: true, requiresTaxId: ['GSTIN', 'PAN'], withinDaysOfKybApproval: 180 },
    limits: { maxAccounts: 500, maxRedemptionsPerAccount: 3 },
  },
];

print(`\n== Billing 1: seed price books and coupons on ${db.getName()} (DRY_RUN=${DRY_RUN}) ==`);

const priceBooks = db.getCollection('priceBooks');
PRICE_BOOKS.forEach((book) => {
  const published = priceBooks.findOne({ region: book.region, status: 'PUBLISHED' }, { version: 1 });
  if (published) {
    print(`  SKIP   price book ${book.region}: version ${published.version} is already published`);
    return;
  }
  const last = priceBooks.find({ region: book.region }, { version: 1 }).sort({ version: -1 }).limit(1).toArray()[0];
  const version = last ? last.version + 1 : 1;
  print(`  CREATE price book ${book.region} v${version}: ${book.plans.map((p) => `${p.code}`).join(', ')}`);
  if (!DRY_RUN) {
    priceBooks.insertOne({ ...book, version, status: 'PUBLISHED', publishedAt: now, publishedBy: PUBLISHED_BY, createdAt: now, updatedAt: now });
  }
});

const coupons = db.getCollection('coupons');
COUPONS.forEach((coupon) => {
  if (coupons.findOne({ code: coupon.code }, { _id: 1 })) {
    print(`  SKIP   coupon ${coupon.code}: already exists`);
    return;
  }
  print(`  CREATE coupon ${coupon.code} (${coupon.region}, ${coupon.percentBps / 100}%)`);
  if (!DRY_RUN) {
    coupons.insertOne({ ...coupon, accountCount: 0, redemptionCount: 0, status: 'ACTIVE', createdAt: now, updatedAt: now });
  }
});

print(DRY_RUN ? '\nDry run: nothing written. Set DRY_RUN = false to apply.' : '\nDone.');
printjson({
  priceBooks: priceBooks.find({ status: 'PUBLISHED' }, { _id: 0, region: 1, version: 1, currency: 1 }).toArray(),
  coupons: coupons.find({}, { _id: 0, code: 1, region: 1, status: 1, accountCount: 1 }).toArray(),
});
