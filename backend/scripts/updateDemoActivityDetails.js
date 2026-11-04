require('dotenv').config({quiet:true});
require('node:dns').setServers(['8.8.8.8','8.8.4.4']);
const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
const batch = 'Fictional demo batch 2026-10-28: 500 additional records';

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
    const result = await ActivityLog.collection.updateMany(
      {detail:batch,username:{$in:['staff1','staff2']},action:'Added record'},
      [{$set:{demoBatch:batch,detail:{$concat:['Record added by ','$username']}}}],
    );
    const remaining = await ActivityLog.countDocuments({detail:batch});
    const verified = await ActivityLog.countDocuments({demoBatch:batch,detail:{$in:['Record added by staff1','Record added by staff2']}});
    console.log(JSON.stringify({updated:result.modifiedCount,remainingBatchLabels:remaining,verified}));
    if (remaining || verified !== 500) throw new Error('Activity detail verification failed.');
  } finally {await mongoose.disconnect();}
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
