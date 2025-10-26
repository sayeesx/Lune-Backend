// scripts/migrate_add_search_fields.js
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
await mongoose.connect(uri, {});

const col = mongoose.connection.db.collection('medicines');

// 1) Add normalized fields (batched update)
await col.updateMany(
  { name: { $type: 'string' } },
  [
    {
      $set: {
        name_lc: { $toLower: '$name' },
        manufacturer_name_lc: {
          $cond: [{ $ne: ['$manufacturer_name', null] }, { $toLower: '$manufacturer_name' }, null]
        },
        type_lc: { $cond: [{ $ne: ['$type', null] }, { $toLower: '$type' }, null] }
      }
    }
  ]
);

// 2) Create indexes optimized for prefix scans and alternatives
await col.createIndex({ name_lc: 1 });                  // fast name prefix lookups
await col.createIndex({ manufacturer_name_lc: 1 });     // manufacturer filter
await col.createIndex({ type_lc: 1 });                  // form filter
await col.createIndex({ short_composition1: 1 });       // alternatives
await col.createIndex({ salt_composition: 1 });         // alternatives

console.log('Indexes and normalized fields ready.');
await mongoose.disconnect();
