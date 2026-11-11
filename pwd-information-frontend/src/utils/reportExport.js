import {jsPDF} from 'jspdf'
import * as XLSX from 'xlsx'

const groupNames = {disabilityType:'Disability Type',barangay:'Barangay',gender:'Gender',age:'Age Group',status:'Status'}
const dateLabel = value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})

export function buildExcelReport({group,start,end,allDates=false,disabilityType,barangay,age,gender,data,total}) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['PWD Registry and Information Management System'],
    ['MSWDO | Villanueva, Misamis Oriental'],
    [`PWD by ${groupNames[group]}`],
    [`Date Range: ${allDates ? 'All dates' : `${dateLabel(start)} - ${dateLabel(end)}`}`],
    [`Disability Type: ${disabilityType || 'All'}`],
    [`Barangay: ${barangay || 'All'}`],
    [`Age Group: ${age || 'All'}`],
    [`Gender: ${gender || 'All'}`],
    [],
    [groupNames[group],'Record Count'],
    ...data.map(([label,count]) => [label,count]),
    [],
    ['Total Records',total],
  ])
  sheet['!cols'] = [{wch:34},{wch:18}]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook,sheet,'PWD Report')
  const bytes = XLSX.write(workbook,{bookType:'xlsx',type:'array'})
  return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}

export function buildPdfReport({group,start,end,allDates=false,disabilityType,barangay,age,gender,data,total}) {
  const pdf = new jsPDF({format:'a4'})
  pdf.setFont('helvetica','bold');pdf.setFontSize(13)
  pdf.text('PWD Registry and Information Management System',18,20)
  pdf.setFont('helvetica','normal');pdf.setFontSize(10)
  pdf.text('MSWDO | Villanueva, Misamis Oriental',18,27)
  pdf.setDrawColor(7,124,49);pdf.line(18,32,192,32)
  pdf.setFont('helvetica','bold');pdf.setFontSize(14)
  pdf.text(`PWD by ${groupNames[group]}`,18,44)
  pdf.setFont('helvetica','normal');pdf.setFontSize(10)
  pdf.text(`${allDates ? 'All dates' : `${dateLabel(start)} - ${dateLabel(end)}`}   |   Total records: ${total}`,18,52)
  pdf.text(`Disability Type: ${disabilityType || 'All'}`,18,59)
  pdf.text(`Barangay: ${barangay || 'All'}`,18,65)
  pdf.text(`Age Group: ${age || 'All'}   |   Gender: ${gender || 'All'}`,18,71)
  const max = Math.max(1,...data.map(([,count]) => count))
  data.forEach(([label,count],index) => {
    if (index > 0 && index % 9 === 0) pdf.addPage()
    const y = index < 9 ? 85 + index * 22 : 28 + (index % 9) * 22
    pdf.setFont('helvetica','normal');pdf.setFontSize(9)
    pdf.text(pdf.splitTextToSize(label,60),18,y)
    pdf.setFillColor(...[[23,156,72],[40,112,197],[215,139,37],[157,84,180],[13,155,156],[199,97,102],[104,135,80],[68,114,164]][index % 8])
    pdf.rect(84,y-5,Math.max(1,count / max * 88),8,'F')
    pdf.setFont('helvetica','bold');pdf.text(String(count),179,y+1)
  })
  return pdf.output('blob')
}

export function downloadReport(blob,filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url),30000)
}
