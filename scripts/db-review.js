// Prints records the membership/tactic migrations could not map unambiguously.
const db = require('../db/connection');

(async () => {
  const items = await db('migration_review_items').orderBy('review_item_id');
  if (!items.length) {
    console.log('No migration review items.');
    return;
  }
  for (const item of items) {
    console.log(
      `#${item.review_item_id} [${item.kind}] ${item.entity} ${item.entity_ref ?? ''}: ${item.detail}` +
        (item.resolved_at ? ' (resolved)' : '')
    );
  }
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
