// Replace the first eleven demo profile photos only, preserving other fields.
require('dotenv').config({quiet:true});
require('node:dns').setServers(['8.8.8.8','8.8.4.4']);
const fs=require('node:fs');
const path=require('node:path');
const mongoose=require('mongoose');
const PwdRecord=require('../models/PwdRecord');
async function main(){
  try{
    const portraits=Array.from({length:11},(_,index)=>{
      const pwdId=`PWD-${String(index+1).padStart(4,'0')}`;
      const bytes=fs.readFileSync(path.join(__dirname,'../demo-portraits',`${pwdId}.jpg`));
      if(bytes.length>400000||bytes[0]!==255||bytes[1]!==216)throw new Error(`Invalid portrait: ${pwdId}`);
      return {pwdId,photo:`data:image/jpeg;base64,${bytes.toString('base64')}`};
    });
    await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
    await mongoose.connection.transaction(async session=>{
      const result=await PwdRecord.bulkWrite(portraits.map(({pwdId,photo})=>({updateOne:{filter:{pwdId},update:{$set:{photo}},timestamps:false}})),{session});
      if(result.matchedCount!==11)throw new Error('Expected eleven matching records.');
      const records=await PwdRecord.find({pwdId:{$in:portraits.map(item=>item.pwdId)}}).select('pwdId photo').session(session).lean();
      if(!portraits.every(item=>records.some(record=>record.pwdId===item.pwdId&&record.photo===item.photo)))throw new Error('Photo verification failed.');
      console.log(JSON.stringify({replaced:result.modifiedCount,verified:records.length}));
    });
  }finally{await mongoose.disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
