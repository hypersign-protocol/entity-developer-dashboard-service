// Billing 4: remove the HUMAN_SUPPORT_24X7 add-on ("24×7 human support").
//
// We no longer offer it, so it must not appear in the catalog or on invoices.
// Invoices copy their add-on lines from the published price book (admin, promotion)
// or from the order's quote (self-serve, payment link), so it is removed from:
//   - price books (every version and status)
//   - quotes (they expire on their own, but one may still be paid)
//   - orders not yet invoiced (an unpaid payment link would still print it)
// Issued invoices are not changed: they are final and never edited.
//
// Run in mongosh (or Compass > MONGOSH) after `use <db>`. Review with DRY_RUN = true first.
// Safe to run again: records without the add-on are left alone.
const DRY_RUN = false;
const CODE = 'HUMAN_SUPPORT_24X7';

const TARGETS = [
  { collection: 'priceBooks', filter: { 'addOns.code': CODE }, pull: { addOns: { code: CODE } } },
  { collection: 'quotes', filter: { 'lines.addOns.code': CODE }, pull: { 'lines.addOns': { code: CODE } } },
  {
    collection: 'orders',
    filter: { 'quote.lines.addOns.code': CODE, invoiceId: { $in: [null, ''] } },
    pull: { 'quote.lines.addOns': { code: CODE } },
  },
];

print(`\n== Billing 4: remove ${CODE} on ${db.getName()} (DRY_RUN=${DRY_RUN}) ==`);
const summary = {};
TARGETS.forEach(({ collection, filter, pull }) => {
  const coll = db.getCollection(collection);
  const count = coll.countDocuments(filter);
  print(`  ${collection}: ${count} to update`);
  summary[collection] = DRY_RUN ? count : coll.updateMany(filter, { $pull: pull }).modifiedCount;
});

const issued = db.getCollection('invoices').countDocuments({ 'addOnLines.code': CODE });
print(`  invoices: ${issued} already issued with it (left unchanged)`);

print(DRY_RUN ? '\nDry run: nothing written. Set DRY_RUN = false to apply.' : '\nDone.');
printjson({ [DRY_RUN ? 'wouldUpdate' : 'updated']: summary, issuedInvoicesUnchanged: issued });
