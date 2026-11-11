const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dns = require("node:dns");

require("dotenv").config();

// Use Google DNS for MongoDB Atlas DNS lookups
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const PwdRecord = require("./models/PwdRecord");
const {purgeExpiredArchives, startArchiveCleanup} = require('./archiveRetention');
const {createSmsHandler} = require('./sms');
const ActivityLog = require('./models/ActivityLog');
const {actorFrom,creatorFor,createActivityMiddleware,createActivityListHandler} = require('./activityLogs');

const specificDisabilities = new Set([
  'Physical Disability', 'Visual Disability', 'Hearing Disability',
  'Intellectual Disability', 'Psychosocial Disability',
  'Speech and Language Disability', 'Learning Disability',
]);

function recordDisabilities(body) {
  if (body.disabilityType !== 'Multiple Disabilities') return [];
  const chosen = [...new Set(Array.isArray(body.disabilities) ? body.disabilities : [])]
    .filter(type => specificDisabilities.has(type));
  return chosen;
}

function missingIdCardDetails(body) {
  const fields = {
    civilStatus: 'Civil Status',
    bloodType: 'Blood Type',
    emergencyContactName: 'Emergency Contact Name',
    emergencyContactPhone: 'Emergency Contact Number',
  };
  return Object.entries(fields)
    .filter(([key]) => typeof body[key] !== 'string' || !body[key].trim())
    .map(([, label]) => label);
}

const app = express();

app.use(cors(process.env.NODE_ENV === 'production' || process.env.SERVER_AUTH === 'true'
  ? {origin:process.env.APP_ORIGIN,credentials:true} : {}));
app.use(express.json({limit: '2mb'}));
const serverAuth = process.env.NODE_ENV === 'production' || process.env.SERVER_AUTH === 'true';
if (serverAuth) require('./auth').installAuth(app);
app.use(createActivityMiddleware(ActivityLog));
app.get('/api/activity-logs', createActivityListHandler(ActivityLog, PwdRecord));
app.post('/api/activity-events', (req,res) => {
  if (actorFrom(req)?.role !== 'Staff') return res.status(403).json({message:'Staff session required.'});
  if (!['Signed in','Signed out','Viewed ID card'].includes(req.body?.action)) return res.status(400).json({message:'Unknown activity.'});
  res.json({ok:true});
});
app.post('/api/messages/send', createSmsHandler({model: PwdRecord,
  ...(process.env.VERCEL ? {acquireSendSlot:require('./smsCooldown').acquireSendSlot} : {})}));
app.use('/api/records/:pwdId/document-photos',require('./routes/documentPhotos'));


// ============================================
// CONNECT TO MONGODB
// ============================================
const databaseReady = mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    if (serverAuth) await require('./auth').bootstrapAdmin();
    if (!process.env.VERCEL) startArchiveCleanup(PwdRecord);
    console.log("✅ MongoDB connected successfully!");
  })
  .catch((error) => {
    console.error(
      "❌ MongoDB connection error:",
      'Database initialization failed.'
    );
    if (process.env.VERCEL) throw new Error('Database initialization failed.');
  });


// ============================================
// TEST BACKEND
// ============================================
app.get("/", (req, res) => {
  if (serverAuth) return res.sendFile(require('node:path').resolve(__dirname,'../pwd-information-frontend/dist/index.html'));
  res.send(
    "PWD Registry and Information Management System Backend is running!"
  );
});

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message:
      "Frontend can communicate with the backend!",
  });
});


// ============================================
// 1. ADD NEW PWD RECORD
// ============================================
app.post("/api/records", async (req, res) => {
  try {
    const missing = missingIdCardDetails(req.body);
    if (missing.length) return res.status(400).json({message: `Required ID card details: ${missing.join(', ')}.`});
    const disabilities = recordDisabilities(req.body);
    if (req.body.disabilityType === 'Multiple Disabilities' && disabilities.length < 2) {
      return res.status(400).json({message: 'Select at least two specific disabilities.'});
    }
    const latestRecord =
      await PwdRecord.findOne().sort({
        pwdId: -1,
      });

    let nextNumber = 1;

    if (latestRecord?.pwdId) {
      const currentNumber =
        parseInt(
          latestRecord.pwdId.replace(
            "PWD-",
            ""
          )
        );

      if (!isNaN(currentNumber)) {
        nextNumber =
          currentNumber + 1;
      }
    }

    const pwdId =
      `PWD-${String(
        nextNumber
      ).padStart(4, "0")}`;

    const newRecord =
      new PwdRecord({
        ...req.body,
        addedBy: creatorFor(req),
        pwdId,
        status: "Active",
        deletedAt: null,
        disabilities,
      });

    const savedRecord =
      await newRecord.save();

    res
      .status(201)
      .json(savedRecord);

  } catch (error) {
    console.error(
      "Error saving record:",
      error
    );

    res.status(500).json({
      message:
        "Failed to save PWD record",
      error: error.message,
    });
  }
});


// ============================================
// 2. GET ALL PWD RECORDS
// ============================================
app.get("/api/records", async (req, res) => {
  try {
    const records =
      await PwdRecord.find({deletedAt: null}).sort({
        pwdId: 1,
      });

    res.json(records);

  } catch (error) {
    console.error(
      "Error getting records:",
      error
    );

    res.status(500).json({
      message:
        "Failed to retrieve records",
      error: error.message,
    });
  }
});


// ============================================
// 3. GET ONE PWD RECORD
// ADD THIS
// ============================================
app.get('/api/records/next-id', async (req, res) => {
  try {
    const latest = await PwdRecord.findOne().sort({pwdId: -1});
    const next = latest ? Number(latest.pwdId.replace('PWD-', '')) + 1 : 1;
    res.json({pwdId: `PWD-${String(next).padStart(4, '0')}`});
  } catch (error) {
    res.status(500).json({message: 'Failed to generate PWD ID'});
  }
});

app.get(
  "/api/records/:pwdId",
  async (req, res) => {
    try {
      const record =
        await PwdRecord.findOne({
          pwdId:
            req.params.pwdId,
          deletedAt: null,
        });

      if (!record) {
        return res
          .status(404)
          .json({
            message:
              "PWD record not found",
          });
      }

      res.json(record);

    } catch (error) {
      console.error(
        "Error getting PWD record:",
        error
      );

      res.status(500).json({
        message:
          "Failed to retrieve PWD record",
        error: error.message,
      });
    }
  }
);

app.post('/api/records/:pwdId/view', async (req, res) => {
  try {
    const record = await PwdRecord.findOneAndUpdate(
      {pwdId: req.params.pwdId, deletedAt: null},
      {$set: {lastViewedAt: new Date()}},
      {new: true, timestamps: false}
    );
    if (!record) return res.status(404).json({message: 'PWD record not found'});
    res.json({lastViewedAt: record.lastViewedAt});
  } catch (error) {
    res.status(500).json({message: 'Failed to track record view'});
  }
});


// ============================================
// 4. UPDATE ONE PWD RECORD
// ADD THIS
// ============================================
app.patch('/api/records/:pwdId/photo', async (req, res) => {
  try {
    const photo = req.body.photo;
    if (typeof photo !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo) || photo.length > 550000) {
      return res.status(400).json({message: 'Choose a PNG, JPEG, WebP or GIF image smaller than 400 KB.'});
    }
    const record = await PwdRecord.findOneAndUpdate(
      {pwdId: req.params.pwdId, deletedAt: null},
      {$set: {photo, lastEditedAt: new Date()}},
      {new: true, runValidators: true}
    );
    if (!record) return res.status(404).json({message: 'PWD record not found'});
    res.json(record);
  } catch (error) {
    res.status(500).json({message: 'Failed to update photo', error: error.message});
  }
});

app.put(
  "/api/records/:pwdId",
  async (req, res) => {
    try {
      const missing = missingIdCardDetails(req.body);
      if (missing.length) return res.status(400).json({message: `Required ID card details: ${missing.join(', ')}.`});
      const disabilities = recordDisabilities(req.body);
      if (req.body.disabilityType === 'Multiple Disabilities' && disabilities.length < 2) {
        return res.status(400).json({message: 'Select at least two specific disabilities.'});
      }
      const updatedRecord =
        await PwdRecord.findOneAndUpdate(
          {
            pwdId:
              req.params.pwdId,
          deletedAt: null,
          },

          {$set: {
            firstName: req.body.firstName,
            middleName: req.body.middleName,
            lastName: req.body.lastName,
            birthdate: req.body.birthdate,
            age: req.body.age,
            barangay: req.body.barangay,
            contact: req.body.contact,
            civilStatus: req.body.civilStatus,
            bloodType: req.body.bloodType,
            emergencyContactName: req.body.emergencyContactName,
            emergencyContactPhone: req.body.emergencyContactPhone,
            photo: req.body.photo,
            address: req.body.address,
            gender: req.body.gender,
            disabilityType: req.body.disabilityType,
            disabilities,
            status: req.body.status,
            lastEditedAt: new Date(),
          }},

          {
            new: true,
            runValidators: true,
          }
        );

      if (!updatedRecord) {
        return res
          .status(404)
          .json({
            message:
              "PWD record not found",
          });
      }

      res.json(updatedRecord);

    } catch (error) {
      console.error(
        "Error updating PWD record:",
        error
      );

      res.status(500).json({
        message:
          "Failed to update PWD record",
        error: error.message,
      });
    }
  }
);


// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 8081;

if (!process.env.VERCEL) app.listen(PORT, () => {
  console.log(
    `🚀 Server running on http://localhost:${PORT}`
  );
});

async function recycleRecord(req, res) {
  try {
    const record = await PwdRecord.findOneAndUpdate(
      {pwdId: req.params.pwdId, deletedAt: null},
      {$set: {deletedAt: new Date()}}, {new: true}
    );
    if (!record) return res.status(404).json({message: 'Active PWD record not found'});
    res.json({message: 'Record archived'});
  } catch (error) { res.status(500).json({message: 'Failed to archive record'}); }
}
app.post('/api/records/:pwdId/recycle', recycleRecord);
app.delete('/api/records/:pwdId', recycleRecord);
app.get('/api/recycle-bin', async (req, res) => {
  try {
    await purgeExpiredArchives(PwdRecord);
    res.json(await PwdRecord.find({deletedAt: {$ne: null}}).sort({deletedAt: -1}));
  }
  catch (error) { res.status(500).json({message: 'Failed to load Archive'}); }
});
app.post('/api/recycle-bin/:pwdId/restore', async (req, res) => {
  try {
    await purgeExpiredArchives(PwdRecord);
    const record = await PwdRecord.findOneAndUpdate(
      {pwdId: req.params.pwdId, deletedAt: {$ne: null}},
      {$set: {deletedAt: null}}, {new: true}
    );
    if (!record) return res.status(404).json({message: 'Record not found in Archive'});
    res.json({message: 'Record restored', pwdId: record.pwdId});
  } catch (error) { res.status(500).json({message: 'Failed to restore record'}); }
});

if (serverAuth && !process.env.VERCEL) {
  const frontend = require('node:path').resolve(__dirname,'../pwd-information-frontend/dist');
  app.use(express.static(frontend));
  app.get('/{*path}',(req,res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({message:'API route not found.'});
    res.sendFile(require('node:path').join(frontend,'index.html'));
  });
  app.use((err,req,res,next) => {
    console.error('Request failed.');
    res.status(500).json({message:'The server could not complete this request.'});
  });
}

module.exports = app;
module.exports.databaseReady = databaseReady;
