const mongoose = require('mongoose');
const {existingSubmission,COOLDOWN_MS} = require('./sms');

// Reuse the existing SMS safeguard collection; beneficiary records are read only.
const schema = new mongoose.Schema({
  _id:String,nextSendAt:Date,fingerprint:String,result:mongoose.Schema.Types.Mixed,
  pendingResult:mongoose.Schema.Types.Mixed,startedAt:Date,
});
const Cooldown = mongoose.models.SmsCooldown || mongoose.model('SmsCooldown',schema);

function createMongoSubmissionStore(model) {
  async function acquireSendSlot(now = new Date()) {
    try {
      await model.findOneAndUpdate(
        {_id:'office-sms',nextSendAt:{$lte:now}},
        {$set:{nextSendAt:new Date(now.getTime() + COOLDOWN_MS)}},
        {upsert:true,new:true}
      );
      return true;
    } catch (error) {
      if (error.code === 11000) return false;
      throw error;
    }
  }
  return {
    acquireSendSlot,
    async lookup({requestId,fingerprint,now}) {
      const existing = await model.findById(`request:${requestId}`).lean();
      return existing ? existingSubmission(existing,fingerprint,now) : null;
    },
    async claim({requestId,fingerprint,now,pendingResult}) {
      const _id = `request:${requestId}`;
      const existing = await model.findById(_id).lean();
      if (existing) return existingSubmission(existing,fingerprint,now);
      if (!await acquireSendSlot(new Date(now))) {
        const concurrent = await model.findById(_id).lean();
        return concurrent ? existingSubmission(concurrent,fingerprint,now) : {status:'cooldown'};
      }
      try {
        await model.create({_id,fingerprint,startedAt:new Date(now),pendingResult});
      } catch (error) {
        if (error.code !== 11000) throw error;
        const concurrent = await model.findById(_id).lean();
        if (!concurrent) throw error;
        return existingSubmission(concurrent,fingerprint,now);
      }
      return {status:'acquired'};
    },
    async finish({requestId,fingerprint,result}) {
      const saved = await model.updateOne({_id:`request:${requestId}`,fingerprint},{$set:{result}});
      if (saved.matchedCount !== 1) throw new Error('SMS reservation missing.');
    },
  };
}

const submissionStore = createMongoSubmissionStore(Cooldown);
module.exports = {submissionStore,createMongoSubmissionStore,acquireSendSlot:submissionStore.acquireSendSlot};
