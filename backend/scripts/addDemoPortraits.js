// Fill empty profile photos on PWD-0001 through PWD-0050 only.
// These portraits are synthetic demo images, not photographs of real registrants.
require('dotenv').config({quiet:true});
require('node:dns').setServers(['8.8.8.8','8.8.4.4']);
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const PwdRecord = require('../models/PwdRecord');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
    const ids = Array.from({length:50},(_,index)=>`PWD-${String(index+1).padStart(4,'0')}`);
    let summary;
    await mongoose.connection.transaction(async session => {
      const records = await PwdRecord.find({pwdId:{$in:ids}}).select('pwdId photo').session(session).lean();
      if (records.length !== 50) throw new Error('Expected all 50 target records to exist.');
      const operations = records.filter(record=>!record.photo).map(record=>{
        const bytes = fs.readFileSync(path.join(__dirname,'../demo-portraits',`${record.pwdId}.jpg`));
        if (bytes.length>400000 || bytes[0]!==255 || bytes[1]!==216) throw new Error(`Invalid portrait for ${record.pwdId}`);
        return {updateOne:{filter:{_id:record._id,$or:[{photo:''},{photo:null},{photo:{$exists:false}}]},update:{$set:{photo:`data:image/jpeg;base64,${bytes.toString('base64')}`}},timestamps:false}};
      });
      const result = operations.length ? await PwdRecord.bulkWrite(operations,{session}) : {modifiedCount:0};
      const withPhotos = await PwdRecord.countDocuments({pwdId:{$in:ids},photo:{$type:'string',$ne:''}}).session(session);
      if (withPhotos!==50) throw new Error('Portrait verification failed.');
      summary={addedPhotos:result.modifiedCount,preservedExistingPhotos:50-result.modifiedCount,targetRecordsWithPhotos:withPhotos};
    });
    console.log(JSON.stringify(summary));
  } finally {await mongoose.disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
