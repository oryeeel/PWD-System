export const disabilityTypes = [
  'Physical Disability',
  'Visual Disability',
  'Hearing Disability',
  'Intellectual Disability',
  'Mental Disability',
  'Psychosocial Disability',
  'Cancer (RA11215)',
  'Rare Disease (RA10747)',
  'Speech and Language Disability',
  'Learning Disability',
  'Multiple Disabilities',
]

export const specificDisabilities = disabilityTypes.filter(type => type !== 'Multiple Disabilities')
