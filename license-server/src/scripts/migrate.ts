import { knex } from '../db.js';
import { migrateLatest } from '../migrations.js';

migrateLatest(knex)
  .then(([batch, log]) => {
    console.log(log.length ? `Applied (batch ${batch}): ${log.join(', ')}` : 'Database is up to date');
    return knex.destroy();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
