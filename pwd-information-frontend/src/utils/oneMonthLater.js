export function oneMonthLater(value) {
  if (!value) return ''
  const [year,month,day] = value.split('-').map(Number)
  const nextMonth = new Date(Date.UTC(year,month,1))
  const lastDay = new Date(Date.UTC(year,month+1,0)).getUTCDate()
  nextMonth.setUTCDate(Math.min(day,lastDay))
  return nextMonth.toISOString().slice(0,10)
}
