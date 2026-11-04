// Add one fictional batch and its simulated staff activity atomically.
// Run from backend: node scripts/add500DemoRecords.js
require('dotenv').config({quiet:true});
require('node:dns').setServers(['8.8.8.8','8.8.4.4']);
const mongoose = require('mongoose');
const PwdRecord = require('../models/PwdRecord');
const ActivityLog = require('../models/ActivityLog');

const batch = 'Fictional demo batch 2026-10-28: 500 additional records';
const firstNames = ['Andrea','Brandon','Carina','Dominic','Estelle','Francis','Giselle','Hector','Iliana','Jasper','Kiara','Lorenzo','Marielle','Nathan','Olivia','Patrick','Queenie','Ramon','Selena','Timothy','Ursula','Vincent','Wendy','Xavier','Yasmin'];
const lastNames = ['Agustin','Barrera','Concepcion','De Guzman','Escobar','Ferrera','Galvez','Hernandez','Ignacio','Jacinto','Legaspi','Macaraeg','Natividad','Ortega','Padilla','Quiroz','Resurreccion','Salcedo','Trinidad','Valencia'];
const middleNames = ['Reyes','Santos','Cruz','Garcia','Flores','Torres','Rivera','Aquino','Castro','Bautista','Perez'];
const barangays = ['Balacanas','Dayawan','Imelda','Katipunan','Kimaya','Looc','Poblacion 1','Poblacion 2','Poblacion 3','San Martin','Tambobong'];
const types = ['Physical Disability','Intellectual Disability','Visual Disability','Psychosocial Disability','Learning Disability','Multiple Disabilities','Hearing Disability','Speech and Language Disability'];

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
    let summary;
    await mongoose.connection.transaction(async session => {
      if (await ActivityLog.exists({$or:[{demoBatch:batch},{detail:batch}]}).session(session)) {
        throw new Error('This batch was already added; no additional records were inserted.');
      }
      const existing = await PwdRecord.find().select('pwdId').session(session).lean();
      const next = Math.max(0,...existing.map(record => Number(record.pwdId.replace(/^PWD-/,'')) || 0)) + 1;
      const now = new Date();
      const today = now.toISOString().slice(0,10);
      const records = Array.from({length:500},(_,index) => {
        const birthdate = `${1945 + index % 65}-${String(index % 12 + 1).padStart(2,'0')}-${String(index % 28 + 1).padStart(2,'0')}`;
        const age = Number(today.slice(0,4)) - Number(birthdate.slice(0,4)) - (today.slice(5) < birthdate.slice(5) ? 1 : 0);
        const barangay = barangays[index % barangays.length];
        const disabilityType = types[index % types.length];
        return {
          pwdId:`PWD-${String(next + index).padStart(4,'0')}`,
          firstName:firstNames[index % firstNames.length],
          middleName:middleNames[index % middleNames.length],
          lastName:lastNames[Math.floor(index / firstNames.length)],
          birthdate,age,gender:index % 2 ? 'Male' : 'Female',
          barangay,address:`${barangay}, Villanueva, Misamis Oriental`,
          disabilityType,disabilities:disabilityType === 'Multiple Disabilities' ? ['Physical Disability','Hearing Disability'] : [],
          civilStatus:index % 3 ? 'Single' : 'Married',bloodType:'Unknown',
          emergencyContactName:`${firstNames[(index + 7) % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length)]}`,
          contact:'',emergencyContactPhone:'',status:'Active',
          addedBy:index % 2 ? 'staff2' : 'staff1',createdAt:now,updatedAt:now,
        };
      });
      const logs = records.map(record => ({
        staffId:record.addedBy === 'staff1' ? '2' : '3',
        username:record.addedBy,staffName:record.addedBy === 'staff1' ? 'MSWDO Staff 1' : 'MSWDO Staff 2',
        action:'Added record',recordId:record.pwdId,detail:`Record added by ${record.addedBy}`,demoBatch:batch,createdAt:now,
      }));
      await PwdRecord.insertMany(records,{session});
      await ActivityLog.insertMany(logs,{session});
      const ids = records.map(record => record.pwdId);
      const inserted = await PwdRecord.countDocuments({pwdId:{$in:ids}}).session(session);
      const logCount = await ActivityLog.countDocuments({demoBatch:batch}).session(session);
      if (inserted !== 500 || logCount !== 500) throw new Error('Batch verification failed.');
      summary = {added:inserted,staff1:250,staff2:250,activityLogs:logCount,firstId:ids[0],lastId:ids.at(-1),totalRecords:existing.length + inserted};
    });
    console.log(JSON.stringify(summary));
  } finally {await mongoose.disconnect();}
}

main().catch(error => {console.error(error.message);process.exitCode=1;});
