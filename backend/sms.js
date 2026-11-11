function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s()+-]/g, '');
  if (/^09\d{9}$/.test(phone)) return `63${phone.slice(1)}`;
  if (/^9\d{9}$/.test(phone)) return `63${phone}`;
  return /^639\d{9}$/.test(phone) ? phone : null;
}

// Local, single-recipient demo only: the existing application has no server-side login.
function createSmsHandler({model, env = process.env, send = fetch, now = Date.now, acquireSendSlot}) {
  let busy = false;
  let nextSendAt = 0;
  return async (req, res) => {
    const address = req.socket?.remoteAddress;
    if (req.authUser?.role !== 'Staff' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
      return res.status(403).json({message: 'SMS demo is available only on this computer.'});
    }
    if (!env.IPROG_API_TOKEN) {
      return res.status(503).json({message: 'Set IPROG_API_TOKEN in backend/.env, then restart the backend.'});
    }
    const {recipientIds, message} = req.body || {};
    if (!Array.isArray(recipientIds) || recipientIds.length !== 1 || typeof recipientIds[0] !== 'string' ||
        typeof message !== 'string' || !message.trim() || message.length > 480) {
      return res.status(400).json({message: 'For this demo, select exactly one recipient and enter a message of up to 480 characters.'});
    }
    if (busy || now() < nextSendAt) return res.status(429).json({message: 'Wait one minute before sending another demo SMS.'});
    busy = true;
    try {
      const record = await model.findOne({pwdId: recipientIds[0], deletedAt: null});
      const phoneNumber = normalizePhone(record?.contact);
      if (!phoneNumber) {
        return res.status(400).json({message: 'The selected record needs a valid Philippine mobile contact number. Edit its contact number before sending.'});
      }
      if (acquireSendSlot && !await acquireSendSlot(new Date(now()))) {
        return res.status(429).json({message:'Wait one minute before sending another SMS.'});
      }
      nextSendAt = now() + 60000;
      const response = await send('https://www.iprogsms.com/api/v1/sms_messages', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({api_token: env.IPROG_API_TOKEN, phone_number: phoneNumber, message: message.trim()}),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok || Number(data.status) !== 200 || !data.message_id) {
        const errorValues = value => {
          if (typeof value === 'string') return [value];
          if (Array.isArray(value)) return value.flatMap(errorValues);
          if (value && typeof value === 'object') return Object.values(value).flatMap(errorValues);
          return [];
        };
        const details = errorValues(data.message || data.errors || data.error || data.data?.errors).join('; ');
        const reason = details
          .split(env.IPROG_API_TOKEN).join('[hidden]')
          .replace(/(?:\+?63|0)9\d{9}/g, '[phone number]')
          .slice(0, 500);
        return res.status(502).json({message: reason
          ? `IPROG: ${reason} Check the IPROG dashboard before retrying.`
          : `IPROG returned HTTP ${response.status || 'unknown'} without confirming acceptance (response fields: ${Object.keys(data || {}).join(', ').slice(0,150)}). Check IPROG SMS history before retrying.`});
      }
      return res.json({status: 'Queued', providerMessageId: data.message_id,
        message: 'IPROG accepted the SMS for delivery. Check your phone or the IPROG dashboard for the delivery result.'});
    } catch {
      return res.status(502).json({message: 'SMS submission could not be confirmed. Check your IPROG dashboard before retrying to avoid duplicate messages.'});
    } finally { busy = false; }
  };
}

module.exports = {normalizePhone, createSmsHandler};
