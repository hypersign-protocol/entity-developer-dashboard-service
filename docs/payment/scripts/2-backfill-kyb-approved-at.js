// Billing 2: set companyVerificationApprovedAt on organisations already KYB-approved.
//
// The KYB webhook sets companyVerificationApprovedAt on the first move to Approved,
// but only from this release on. FOUNDING coupons need it ("within 180 days of KYB
// approval"), so organisations approved earlier get an approximation here: the
// onboarding record's updatedAt. Review the list; it is a best guess, not the real date.
//
// Run in mongosh (or Compass > MONGOSH) after `use <db>`. Review with DRY_RUN = true first.
// Safe to run again: only records without the field are changed.
const DRY_RUN = false;

const filter = {
  companyVerificationStatus: 'Approved',
  companyVerificationApprovedAt: { $exists: false },
};

print(`\n== Billing 2: backfill companyVerificationApprovedAt on ${db.getName()} (DRY_RUN=${DRY_RUN}) ==`);
const orgs = db.customeronboardings.find(filter, { companyName: 1, updatedAt: 1, createdAt: 1 }).toArray();
orgs.forEach((o) => print(`  ${o._id}  "${o.companyName}"  approvedAt := ${(o.updatedAt || o.createdAt).toISOString()}`));

if (!DRY_RUN) {
  orgs.forEach((o) => {
    db.customeronboardings.updateOne(
      { _id: o._id, companyVerificationApprovedAt: { $exists: false } },
      { $set: { companyVerificationApprovedAt: o.updatedAt || o.createdAt } },
    );
  });
}
printjson({ [DRY_RUN ? 'wouldSet' : 'set']: orgs.length });
