// Matches the application's existing browser session model. Actor identity is
// client-reported; this is an operational history, not a tamper-proof audit trail.
function actorFrom(req) {
  try {
    const raw = req.headers?.['x-pwd-actor'];
    if (typeof raw !== 'string' || raw.length > 2000) return null;
    const actor = JSON.parse(decodeURIComponent(raw));
    if (!['Admin', 'Staff'].includes(actor.role) || !actor.username || actor.id == null) return null;
    return {id: String(actor.id).slice(0,80), username: String(actor.username).slice(0,100),
      fullname: String(actor.fullname || actor.username).slice(0,150), role: actor.role};
  } catch { return null; }
}

function actionFor(req, payload) {
  const path = req.path || '';
  const match = path.match(/^\/api\/(?:records|recycle-bin)\/([^/]+)/);
  const recordId = match ? decodeURIComponent(match[1]) : '';
  if (req.method === 'POST' && path === '/api/records') return {action:'Added record',recordId:payload?.pwdId || ''};
  if (req.method === 'POST' && /^\/api\/records\/[^/]+\/view$/.test(path)) return {action:'Viewed record',recordId};
  if ((req.method === 'POST' && path.endsWith('/recycle')) || (req.method === 'DELETE' && /^\/api\/records\/[^/]+$/.test(path))) return {action:'Archived record',recordId};
  if (req.method === 'POST' && /^\/api\/recycle-bin\/[^/]+\/restore$/.test(path)) return {action:'Restored record',recordId};
  if (req.method === 'PUT' && /^\/api\/records\/[^/]+$/.test(path)) return {action:'Updated record',recordId};
  if (req.method === 'PATCH' && /^\/api\/records\/[^/]+\/photo$/.test(path)) return {action:'Updated profile photo',recordId};
  if (req.method === 'PATCH' && /^\/api\/records\/[^/]+\/document-photos\//.test(path)) return {action:'Updated document photo',recordId,detail:path.endsWith('/proofOfDisability') ? 'Proof of disability' : 'PWD ID photo'};
  if (req.method === 'POST' && path === '/api/messages/send') return {action:'Submitted SMS',recordId:req.body?.recipientIds?.[0] || '',detail:'Accepted by IPROG for delivery'};
  if (req.method === 'POST' && path === '/api/activity-events' && ['Signed in','Signed out','Viewed ID card'].includes(req.body?.action)) return {action:req.body.action,recordId:String(req.body.recordId || '').slice(0,100)};
  return null;
}

function creatorFor(req) {
  return actorFrom(req)?.username || 'Unknown';
}

function createActivityMiddleware(model, logger = console) {
  return (req, res, next) => {
    const actor = actorFrom(req);
    if (actor?.role !== 'Staff') return next();
    // Express rewrites req.path while a mounted router handles the request.
    const eventRequest = {method:req.method, path:(req.originalUrl || req.path || '').split('?')[0], body:req.body};
    let payload;
    const json = res.json;
    res.json = function(data) {payload=data;return json.call(this,data);};
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const event = actionFor(eventRequest, payload);
      if (!event) return;
      Promise.resolve().then(() => model.create({staffId:actor.id, username:actor.username,staffName:actor.fullname,...event}))
        .catch(() => logger.error('Could not save staff activity log.'));
    });
    next();
  };
}

function createActivityListHandler(model, recordModel) {
  return async (req,res) => {
    if (actorFrom(req)?.role !== 'Admin') return res.status(403).json({message:'Only admins can view activity logs.'});
    try {
      const page = Math.max(1,parseInt(req.query.page,10) || 1);
      const requestedSize = Number(req.query.pageSize);
      const pageSize = [20,50,100].includes(requestedSize) ? requestedSize : 20;
      const query = String(req.query.search || '').trim().slice(0,100);
      const filter = {};
      const username = String(req.query.staff || '').trim().slice(0,100);
      if (username) filter.username = username;
      if (query) {
        const expression = [...query].map(char => '^$.*+?()[]{}|\\'.includes(char) ? '\\' + char : char).join('');
        filter.$or = ['staffName','username','action','recordId'].map(field => ({[field]:{$regex:expression,$options:'i'}}));
      }
      const from = req.query.from && new Date(`${req.query.from}T00:00:00+08:00`);
      const to = req.query.to && new Date(`${req.query.to}T23:59:59.999+08:00`);
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) return res.status(400).json({message:'Choose a valid date range.'});
      if (from || to) filter.createdAt = {...(from ? {$gte:from} : {}),...(to ? {$lte:to} : {})};
      const total = await model.countDocuments(filter);
      const pages = Math.max(1,Math.ceil(total / pageSize));
      const current = Math.min(page,pages);
      const logs = await model.find(filter).sort({createdAt:-1,_id:-1}).skip((current-1)*pageSize).limit(pageSize).lean();
      if (recordModel) {
        const ids = [...new Set(logs.map(log => log.recordId).filter(Boolean))];
        const records = ids.length ? await recordModel.find({pwdId:{$in:ids}}).select('pwdId firstName middleName lastName').lean() : [];
        const names = new Map(records.map(record => [record.pwdId,[record.firstName,record.middleName,record.lastName].filter(Boolean).join(' ')]));
        for (const log of logs) log.recordName = names.get(log.recordId) || '';
      }
      res.json({logs,total,page:current,pages,pageSize});
    } catch {res.status(500).json({message:'Could not load activity logs.'});}
  };
}

module.exports = {actorFrom,creatorFor,actionFor,createActivityMiddleware,createActivityListHandler};
