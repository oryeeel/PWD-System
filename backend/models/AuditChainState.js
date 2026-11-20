const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id:{type:String,required:true},
  version:{type:Number,required:true},
  baselineCount:{type:Number,required:true},
  baselineHash:{type:String,required:true},
  baselineSignature:{type:String,required:true},
  sequence:{type:Number,required:true,default:0},
  lastHash:{type:String,required:true},
  createdAt:{type:Date,required:true},
  updatedAt:{type:Date,required:true},
},{versionKey:false,collection:'auditchainstates'});

module.exports = mongoose.models.AuditChainState || mongoose.model('AuditChainState',schema);
