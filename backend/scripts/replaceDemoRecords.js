// Replaces every PWD record with fictional demonstration data.
// Run explicitly with: node scripts/replaceDemoRecords.js --replace-all
require('dotenv').config({quiet: true});
const mongoose = require('mongoose');
const PwdRecord = require('../models/PwdRecord');

const disabilityTypes = [
  'Physical Disability', 'Visual Disability', 'Hearing Disability',
  'Intellectual Disability', 'Psychosocial Disability',
  'Speech and Language Disability', 'Learning Disability',
  'Multiple Disabilities',
];
const barangays = [
  'Balacanas', 'Dayawan', 'Imelda', 'Katipunan', 'Kimaya', 'Looc',
  'Poblacion 1', 'Poblacion 2', 'Poblacion 3', 'San Martin', 'Tambobong',
];
const multipleCombinations = [
  ['Physical Disability','Visual Disability'],
  ['Hearing Disability','Speech and Language Disability'],
  ['Intellectual Disability','Learning Disability'],
  ['Physical Disability','Psychosocial Disability'],
];

// Fictional names and birthdates; no real contact numbers are included.
const people = [
  ['Althea', 'Mendoza', '1998-04-12', 'Female'],
  ['Marco', 'Del Rosario', '1976-11-03', 'Male'],
  ['Beatriz', 'Navarro', '1985-07-21', 'Female'],
  ['Elijah', 'Villareal', '2002-02-18', 'Male'],
  ['Camille', 'Soriano', '1991-09-06', 'Female'],
  ['Nico', 'Alcantara', '1968-12-14', 'Male'],
  ['Daphne', 'Mercado', '2005-05-09', 'Female'],
  ['Rafael', 'Tolentino', '1980-01-27', 'Male'],
  ['Iris', 'Magsino', '1994-03-30', 'Female'],
  ['Paolo', 'Lazaro', '1972-08-16', 'Male'],
  ['Clarisse', 'Bautista', '2000-10-11', 'Female'],
  ['Enzo', 'Valdez', '1988-06-23', 'Male'],
  ['Mikaela', 'Castillo', '1963-04-07', 'Female'],
  ['Andre', 'Panganiban', '1997-12-02', 'Male'],
  ['Sofia', 'Robles', '1982-09-19', 'Female'],
  ['Gabriel', 'Lim', '2007-01-05', 'Male'],
  ['Hazel', 'Montemayor', '1979-07-13', 'Female'],
  ['Tristan', 'Evangelista', '1990-05-28', 'Male'],
  ['Nadine', 'Salazar', '2003-11-24', 'Female'],
  ['Julian', 'Abad', '1959-02-09', 'Male'],
  ['Katrina', 'Manalo', '1987-08-01', 'Female'],
  ['Luis', 'Sarmiento', '1996-06-17', 'Male'],
  ['Rhea', 'Dominguez', '1974-03-08', 'Female'],
  ['Anton', 'Beltran', '2001-12-29', 'Male'],
  ['Mae', 'Quintana', '1993-01-14', 'Female'],
  ['Diego', 'Arellano', '1966-10-20', 'Male'],
  ['Liana', 'Cordero', '2006-07-04', 'Female'],
  ['Simon', 'Ocampo', '1983-05-15', 'Male'],
  ['Tessa', 'Madrigal', '1999-09-25', 'Female'],
  ['Felix', 'Aguilar', '1970-11-10', 'Male'],
];

const ageOn = (birthdate, now) => {
  const birth = new Date(`${birthdate}T00:00:00Z`);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() ||
      (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
};

async function main() {
  if (process.argv[2] !== '--replace-all') {
    throw new Error('Pass --replace-all to replace all existing PWD records.');
  }
  await mongoose.connect(process.env.MONGODB_URI, {serverSelectionTimeoutMS: 5000});
  const now = new Date();
  const records = people.map(([firstName, lastName, birthdate, gender], index) => {
    const barangay = barangays[(index * 7) % barangays.length];
    return {
      pwdId: `PWD-${String(index + 1).padStart(4, '0')}`,
      firstName, middleName: '', lastName, birthdate,
      age: ageOn(birthdate, now), gender, barangay,
      address: `${barangay}, Villanueva, Misamis Oriental`,
      disabilityType: disabilityTypes[(index * 3) % disabilityTypes.length],
      disabilities: disabilityTypes[(index * 3) % disabilityTypes.length] === 'Multiple Disabilities'
        ? multipleCombinations[index % multipleCombinations.length] : [],
      contact: '', status: index % 7 === 0 ? 'Inactive' : 'Active',
      addedBy: index % 2 === 0 ? 'staff1' : 'staff2',
      createdAt: new Date(now.getTime() - (people.length - index) * 86400000),
      updatedAt: new Date(now.getTime() - (people.length - index) * 86400000),
    };
  });
  await PwdRecord.deleteMany({});
  await PwdRecord.insertMany(records);
  console.log(`Replaced all previous PWD records with ${records.length} fictional records.`);
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
