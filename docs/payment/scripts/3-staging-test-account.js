// Billing 3 (STAGING ONLY): make one test organisation eligible for the FOUNDING coupon.
//
// FOUNDING8 needs KYB approval within 180 days and a GSTIN or PAN. Tax ids are only
// stored locally once the billing profile ships (epic 3), so this sets them by hand
// for testing. Never run it on production.
//
// Run in mongosh (or Compass > MONGOSH) after `use <db>`. Review with DRY_RUN = true first.
const DRY_RUN = false;

const OWNER_EMAIL = 'vishwasbhushan001@gmail.com'; // the test account's login email
const REGION = 'IN'; // 'IN' (FOUNDING8, INR) or 'GLOBAL' (FOUNDING15, USD)
const TAX_IDS = [{ type: 'GSTIN', number: '29ABCDE1234F1Z5' }]; // only checked for IN

if (/prod/i.test(db.getName())) throw new Error(`ABORT: ${db.getName()} looks like production`);

const user = db.users.findOne({ email: OWNER_EMAIL }, { userId: 1 });
if (!user) throw new Error(`ABORT: no user ${OWNER_EMAIL}`);
const org = db.customeronboardings.findOne({ userId: user.userId }, { companyName: 1, billing: 1, companyVerificationStatus: 1 });
if (!org) throw new Error(`ABORT: ${OWNER_EMAIL} has no onboarding record`);

const set = {
  companyVerificationStatus: 'Approved',
  companyVerificationApprovedAt: new Date(),
  'billing.region': REGION,
  'billing.currency': REGION === 'IN' ? 'INR' : 'USD',
  ...(REGION === 'IN' && { 'billing.taxIds': TAX_IDS }),
};
print(`\n== Billing 3: test account ${OWNER_EMAIL} → "${org.companyName}" (${org._id}) (DRY_RUN=${DRY_RUN}) ==`);
printjson({ before: { kyb: org.companyVerificationStatus, billing: org.billing || null }, set });
if (!DRY_RUN) db.customeronboardings.updateOne({ _id: org._id }, { $set: set });
