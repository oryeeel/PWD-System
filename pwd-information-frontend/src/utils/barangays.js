export const barangays = ['BALACANAS','DAYAWAN','IMELDA','KATIPUNAN','KIMAYA','LOOC','POBLACION 1','POBLACION 2','POBLACION 3','SAN MARTIN','TAMBOBONG']

const barangayNames = new Map(barangays.map(name => [name.toUpperCase(),name]))

export function normalizeBarangay(value) {
  if (typeof value !== 'string') return ''
  const name = value.trim().replace(/\s+/g,' ')
  return barangayNames.get(name.toUpperCase()) || name
}
