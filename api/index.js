// Vercel deploys this handler as one function. Static frontend files use its CDN.
const app = require('../backend/server');
module.exports = async function handler(req,res) {
  try {
    await app.databaseReady;
  } catch {
    return res.status(503).json({message:'Database unavailable. Please try again later.'});
  }
  req.activityWrites = [];
  await new Promise((resolve,reject) => {
    res.once('finish',resolve);
    res.once('close',resolve);
    try {app(req,res);} catch(err) {reject(err);}
  });
  // Keep the function alive until audit writes triggered by response completion finish.
  await Promise.all(req.activityWrites);
};
