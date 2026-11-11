const mongoose = require('mongoose');
const schema = new mongoose.Schema({_id:String,nextSendAt:Date});
const Cooldown = mongoose.models.SmsCooldown || mongoose.model('SmsCooldown',schema);

// One shared provider cooldown across concurrently running serverless instances.
async function acquireSendSlot(now=new Date()) {
  try {
    await Cooldown.findOneAndUpdate(
      {_id:'office-sms',nextSendAt:{$lte:now}},
      {$set:{nextSendAt:new Date(now.getTime()+60000)}},
      {upsert:true,new:true}
    );
    return true;
  } catch(err) {
    if (err.code === 11000) return false;
    throw err;
  }
}
module.exports = {acquireSendSlot};
