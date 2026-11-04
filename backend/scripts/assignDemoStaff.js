// Assign existing fictional demo records evenly between the two staff accounts.
require('dotenv').config({quiet: true});
const mongoose = require('mongoose');
const PwdRecord = require('../models/PwdRecord');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {serverSelectionTimeoutMS: 5000});
    const records = await PwdRecord.find({addedBy: 'Demo Data'})
      .select('_id').sort({pwdId: 1}).lean();
    const operations = records.map((record, index) => ({updateOne: {
      filter: {_id: record._id, addedBy: 'Demo Data'},
      update: {$set: {addedBy: index % 2 === 0 ? 'staff1' : 'staff2'}},
      timestamps: false,
    }}));
    const result = operations.length ? await PwdRecord.bulkWrite(operations) : {modifiedCount: 0};
    const remaining = await PwdRecord.countDocuments({addedBy: 'Demo Data'});
    console.log(JSON.stringify({updated: result.modifiedCount, remainingDemoData: remaining}));
    if (remaining) throw new Error('Some demo records still need staff assignment.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
