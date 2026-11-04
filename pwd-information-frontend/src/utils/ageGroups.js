export function countAgeGroups(records) {
  const groups = [
    {label:'0 - 17',count:0}, {label:'18 - 20',count:0},
    {label:'21 - 40',count:0}, {label:'41 - 60',count:0},
    {label:'61 & above',count:0},
  ]
  let unknown = 0
  for (const record of records) {
    const value = record.age
    const age = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN
    if (!Number.isInteger(age) || age < 0) {unknown++;continue}
    const index = age <= 17 ? 0 : age <= 20 ? 1 : age <= 40 ? 2 : age <= 60 ? 3 : 4
    groups[index].count++
  }
  if (unknown) groups.push({label:'Unspecified',count:unknown})
  return groups
}
