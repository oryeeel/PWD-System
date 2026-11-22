const {createHash, randomUUID} = require('node:crypto');

const MAX_RECIPIENTS = 20;
const MAX_MESSAGE_LENGTH = 480;
const COOLDOWN_MS = 60000;
const PENDING_RESULT_MS = 30000;

function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s()+-]/g, '');
  if (/^09\d{9}$/.test(phone)) return `63${phone.slice(1)}`;
  if (/^9\d{9}$/.test(phone)) return `63${phone}`;
  return /^639\d{9}$/.test(phone) ? phone : null;
}

function existingSubmission(entry, fingerprint, now = Date.now()) {
  if (entry.fingerprint !== fingerprint) return {status:'conflict'};
  if (entry.result) return {status:'replay',result:entry.result};
  if (entry.pendingResult && Number(entry.startedAt) + PENDING_RESULT_MS <= now) {
    return {status:'replay',result:entry.pendingResult};
  }
  return {status:'pending'};
}

// Unit tests use this injected store. The server always supplies the Mongo store.
function createMemorySubmissionStore() {
  const entries = new Map();
  let nextSendAt = 0;
  return {
    async lookup({requestId,fingerprint,now}) {
      return entries.has(requestId) ? existingSubmission(entries.get(requestId),fingerprint,now) : null;
    },
    async claim({requestId,fingerprint,now,pendingResult}) {
      if (entries.has(requestId)) return existingSubmission(entries.get(requestId),fingerprint,now);
      if (now < nextSendAt) return {status:'cooldown'};
      nextSendAt = now + COOLDOWN_MS;
      entries.set(requestId,{fingerprint,startedAt:now,pendingResult});
      return {status:'acquired'};
    },
    async finish({requestId,fingerprint,result}) {
      const entry = entries.get(requestId);
      if (!entry || entry.fingerprint !== fingerprint) throw new Error('SMS reservation missing.');
      entry.result = result;
    },
  };
}

function safeProviderText(value, token) {
  const strings = (item, depth = 0) => {
    if (typeof item === 'string') return [item];
    if (!item || depth > 4 || typeof item !== 'object') return [];
    return Object.values(item).slice(0,10).flatMap(child => strings(child,depth + 1));
  };
  return strings(value).join('; ').split(token).join('[hidden]')
    .replace(/(?:\+?63|0)9\d{9}/g,'[phone number]').slice(0,500);
}

function createSmsHandler({model,env = process.env,send = fetch,now = Date.now,
  submissionStore = createMemorySubmissionStore(), getSubmissionStore,
  providerTimeoutMs = 8000, batchTimeoutMs = 20000, concurrency = 3}) {
  return async (req,res) => {
    const address = req.socket?.remoteAddress;
    if (req.authUser?.role !== 'Staff' && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)) {
      return res.status(403).json({message:'Sign in as Staff to send SMS notifications.'});
    }
    if (!env.IPROG_API_TOKEN) return res.status(503).json({message:'SMS is not configured. Set IPROG_API_TOKEN in the backend environment.'});
    const {recipientIds,message,requestId:providedRequestId} = req.body || {};
    if (!Array.isArray(recipientIds) || !recipientIds.length || recipientIds.length > MAX_RECIPIENTS ||
        recipientIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 100) ||
        typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH ||
        (providedRequestId !== undefined && (typeof providedRequestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(providedRequestId)))) {
      return res.status(400).json({message:`Select 1–${MAX_RECIPIENTS} recipients and enter a message of up to ${MAX_MESSAGE_LENGTH} characters. Use a valid submission ID.`});
    }
    // Older clients may omit the ID; current clients retain it across retries.
    const requestId = providedRequestId || randomUUID();
    const ids = [...new Set(recipientIds)];
    const text = message.trim();
    const actor = req.authUser?.id || 'local';
    const fingerprint = createHash('sha256').update(JSON.stringify({actor,ids:[...ids].sort(),message:text})).digest('hex');
    let store, groups, startedAt;
    function replyReservation(reservation) {
      if (reservation.status === 'replay') return res.json({...reservation.result,replayed:true});
      if (reservation.status === 'conflict') return res.status(409).json({requestId,message:'This submission ID was already used for different content. Start a new message.'});
      if (reservation.status === 'pending') return res.status(409).json({requestId,pending:true,message:'This submission is already processing. Retry this same submission ID to check its result; this will not send it again.'});
      return res.status(429).json({requestId,message:'Wait one minute before sending another SMS batch.'});
    }
    try {
      store = getSubmissionStore ? getSubmissionStore() : submissionStore;
      const existing = await store.lookup?.({requestId,fingerprint,now:now()});
      if (existing) return replyReservation(existing);
      const records = await model.find({pwdId:{$in:ids},deletedAt:null},'pwdId contact');
      const recordsById = new Map(records.map(record => [record.pwdId,record]));
      const invalidRecipientIds = ids.filter(id => !normalizePhone(recordsById.get(id)?.contact));
      if (invalidRecipientIds.length) return res.status(400).json({message:'Every selected beneficiary must have an active record and a valid Philippine mobile number. Remove invalid recipients before sending.',invalidRecipientIds});
      const byPhone = new Map();
      for (const id of ids) {
        const phoneNumber = normalizePhone(recordsById.get(id).contact);
        if (!byPhone.has(phoneNumber)) byPhone.set(phoneNumber,{phoneNumber,recipientIds:[]});
        byPhone.get(phoneNumber).recipientIds.push(id);
      }
      groups = [...byPhone.values()];
      const pendingResult = {requestId,replayed:false,status:'Unknown',
        results:groups.map(group => ({...group,status:'Unknown',message:'The server could not recover this submission result. Check IPROG history before retrying.'})),
        counts:{selected:ids.length,unique:groups.length,duplicates:ids.length - groups.length,submitted:0,failed:0,unknown:groups.length,notSent:0},
        message:'The previous submission result is unconfirmed. No SMS was resent. Check the IPROG dashboard before creating any new submission.'};
      startedAt = now();
      const reservation = await store.claim({requestId,fingerprint,now:startedAt,pendingResult});
      if (reservation.status !== 'acquired') return replyReservation(reservation);
    } catch {
      return res.status(503).json({requestId,message:'SMS records or submission safeguards are unavailable. This attempt did not send SMS. Keep the same submission ID when checking an earlier attempt.'});
    }

    const results = groups.map(group => ({...group,status:'NotSent',message:'Not submitted because the batch time limit was reached.'}));
    let cursor = 0;
    async function worker() {
      while (cursor < groups.length) {
        const remaining = batchTimeoutMs - (now() - startedAt);
        // Do not start a request that cannot receive its full response window.
        if (remaining < providerTimeoutMs) return;
        const index = cursor++;
        const group = groups[index];
        try {
          const response = await send('https://www.iprogsms.com/api/v1/sms_messages',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({api_token:env.IPROG_API_TOKEN,phone_number:group.phoneNumber,message:text}),
            signal:AbortSignal.timeout(providerTimeoutMs),
          });
          const data = await response.json();
          const providerMessageId = (typeof data?.message_id === 'string' || typeof data?.message_id === 'number') ? String(data.message_id) : '';
          if (response.ok && Number(data?.status) === 200 && providerMessageId && providerMessageId.length <= 150 && !providerMessageId.includes(env.IPROG_API_TOKEN)) {
            results[index] = {...group,status:'Queued',providerMessageId};
            continue;
          }
          const reason = safeProviderText(data?.message || data?.errors || data?.error || data?.data?.errors,env.IPROG_API_TOKEN);
          const providerReason = String(reason || '').toLowerCase();
          if (providerReason.includes('invalid token')) {
            results[index] = {...group,status:'Unknown',message:'IPROG rejected the configured API token. The SMS account administrator must verify the backend IPROG_API_TOKEN before retrying.'};
            continue;
          }
          if (providerReason.includes('sender name') || providerReason.includes('sender id')) {
            results[index] = {...group,status:'Unknown',message:'IPROG requires an approved sender name for this network. The SMS account administrator must configure sender routing before retrying.'};
            continue;
          }
          const explicitRejection = (response.status >= 400 && response.status < 500) ||
            (data?.status != null && Number(data.status) !== 200 && Number(data.status) < 500 && Number.isFinite(Number(data.status)));
          results[index] = {...group,status:explicitRejection ? 'Failed' : 'Unknown',message:reason
            ? `IPROG: ${reason} Check the IPROG dashboard before retrying.`
            : explicitRejection ? 'IPROG rejected this SMS submission.' : 'IPROG did not confirm acceptance. Check the IPROG dashboard before retrying.'};
        } catch {
          results[index] = {...group,status:'Unknown',message:'SMS acceptance could not be confirmed. Check the IPROG dashboard before retrying to avoid duplicate messages.'};
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),3,groups.length)},worker));
    const counts = {selected:ids.length,unique:groups.length,duplicates:ids.length - groups.length,
      submitted:results.filter(item => item.status === 'Queued').length,
      failed:results.filter(item => item.status === 'Failed').length,
      unknown:results.filter(item => item.status === 'Unknown').length,
      notSent:results.filter(item => item.status === 'NotSent').length};
    const status = counts.submitted === counts.unique ? 'Queued' : counts.submitted ? 'Partial' : counts.unknown ? 'Unknown' : 'Failed';
    const result = {requestId,replayed:false,status,results,counts,
      message:`${counts.submitted} submitted to IPROG; ${counts.failed} failed; ${counts.unknown} unconfirmed; ${counts.notSent} not sent. Submission is not confirmation of delivery.`,
      ...(results.length === 1 && results[0].providerMessageId ? {providerMessageId:results[0].providerMessageId} : {})};
    try {
      await store.finish({requestId,fingerprint,result});
    } catch {
      // Keep the reservation: a lost result must never cause an automatic resend.
      result.message += ' The server could not save the result; keep this receipt and check IPROG before any retry.';
      result.persistenceWarning = true;
    }
    return res.json(result);
  };
}

module.exports = {normalizePhone,createSmsHandler,createMemorySubmissionStore,existingSubmission,
  MAX_RECIPIENTS,MAX_MESSAGE_LENGTH,COOLDOWN_MS,PENDING_RESULT_MS};
