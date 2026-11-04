// Adds 20 fictional records to the existing database.
require('dotenv').config({quiet: true});
const mongoose = require('mongoose');
const PwdRecord = require('../models/PwdRecord');

const people = [
  ['Ariana', 'Fajardo', '1992-02-16', 'Female', 'Hearing Disability', 'Imelda'],
  ['Dario', 'Roxas', '1978-09-07', 'Male', 'Physical Disability', 'San Martin'],
  ['Bianca', 'Lacson', '2004-06-12', 'Female', 'Visual Disability', 'Kimaya'],
  ['Victor', 'Mendoza Jr.', '1986-01-24', 'Male', 'Psychosocial Disability', 'Dayawan'],
  ['Elena', 'Gonzales', '1969-11-19', 'Female', 'Intellectual Disability', 'Looc'],
  ['Matteo', 'Dizon', '1999-04-03', 'Male', 'Multiple Disabilities', 'Poblacion 2'],
  ['Celine', 'Buenaventura', '1981-08-28', 'Female', 'Learning Disability', 'Balacanas'],
  ['Noel', 'Caballero', '1973-03-10', 'Male', 'Speech and Language Disability', 'Katipunan'],
  ['Mara', 'Alvarez', '2008-12-05', 'Female', 'Physical Disability', 'Tambobong'],
  ['Isaac', 'De Vera', '1995-07-17', 'Male', 'Visual Disability', 'Poblacion 3'],
  ['Lourdes', 'Santiago', '1957-05-22', 'Female', 'Hearing Disability', 'Poblacion 1'],
  ['Adrian', 'Rivera', '1989-10-14', 'Male', 'Psychosocial Disability', 'Imelda'],
  ['Mireya', 'Ramos', '2001-03-31', 'Female', 'Multiple Disabilities', 'San Martin'],
  ['Emilio', 'Pineda', '1971-06-09', 'Male', 'Intellectual Disability', 'Kimaya'],
  ['Janine', 'Espinosa', '1997-11-26', 'Female', 'Learning Disability', 'Dayawan'],
  ['Cyrus', 'Medina', '1984-02-02', 'Male', 'Physical Disability', 'Looc'],
  ['Therese', 'Pascual', '2006-09-13', 'Female', 'Speech and Language Disability', 'Poblacion 2'],
  ['Owen', 'Fernandez', '1964-04-18', 'Male', 'Visual Disability', 'Balacanas'],
  ['Isabel', 'Tan', '1990-12-21', 'Female', 'Hearing Disability', 'Katipunan'],
  ['Benedict', 'Molina', '1975-08-06', 'Male', 'Physical Disability', 'Tambobong'],
];

function ageOn(date, today) {
  const birth = new Date(`${date}T00:00:00Z`);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth() ||
      (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {serverSelectionTimeoutMS: 5000});
  const existing = await PwdRecord.find({
    $or: people.map(([firstName, lastName, birthdate]) => ({firstName, lastName, birthdate})),
  }).select('pwdId').lean();
  if (existing.length) throw new Error('Some of these demo records already exist; nothing was added.');
  const latest = await PwdRecord.findOne().sort({pwdId: -1}).select('pwdId').lean();
  const next = latest ? Number(latest.pwdId.slice(4)) + 1 : 1;
  const today = new Date();
  const records = people.map(([firstName, lastName, birthdate, gender, disabilityType, barangay], index) => ({
    pwdId: `PWD-${String(next + index).padStart(4, '0')}`,
    firstName, middleName: '', lastName, birthdate, age: ageOn(birthdate, today), gender,
    disabilityType, barangay, address: `${barangay}, Villanueva, Misamis Oriental`,
    disabilities: disabilityType === 'Multiple Disabilities'
      ? (index % 2 ? ['Physical Disability','Hearing Disability'] : ['Visual Disability','Learning Disability']) : [],
    contact: '', status: index % 6 === 0 ? 'Inactive' : 'Active', addedBy: index % 2 === 0 ? 'staff1' : 'staff2',
  }));
  await PwdRecord.insertMany(records);
  console.log(`Added ${records.length} fictional PWD records (${records[0].pwdId}–${records.at(-1).pwdId}).`);
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
