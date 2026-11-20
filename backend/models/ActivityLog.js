const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  staffId: {type: String, required: true},
  username: {type: String, required: true},
  staffName: {type: String, required: true},
  action: {type: String, required: true},
  recordId: {type: String, default: ''},
  detail: {type: String, default: ''},
  actorRole: {type:String,enum:['Admin','Staff']},
  chainSequence:{type:Number,select:false},
  previousHash:{type:String,select:false},
  entryHash:{type:String,select:false},
  demoBatch: {type: String, select: false},
}, {timestamps: {createdAt: true, updatedAt: false}});
schema.index({createdAt: -1, _id: -1});
module.exports = mongoose.model('ActivityLog', schema);
