import {jsPDF} from 'jspdf'
import * as XLSX from 'xlsx'
import {barangays} from './barangays'

export const columns = ['No.', 'PWD ID', 'Last Name', 'First Name', 'Middle Name', 'Disability Type', 'Barangay', 'Date Added', 'Status']
const office = 'PWD Registry and Information Management System'
export function groupBarangayRecords(records) {
  const groups = barangays.map(name => ({name, records:[]}))
  const unassigned = {name:'Unassigned', records:[]}
  for (const record of records) (groups.find(group => group.name === record.barangay) || unassigned).records.push(record)
  if (unassigned.records.length) groups.push(unassigned)
  for (const group of groups) group.records.sort((a,b) => `${a.lastName} ${a.firstName} ${a.pwdId}`.localeCompare(`${b.lastName} ${b.firstName} ${b.pwdId}`))
  return groups
}
export function recordCells(record,index) {
  const disability = record.disabilityType === 'Multiple Disabilities' && record.disabilities?.length ? `${record.disabilityType}: ${record.disabilities.join(', ')}` : record.disabilityType
  return [index+1,record.pwdId,record.lastName,record.firstName,record.middleName,disability,record.barangay || 'Unassigned',String(record.createdAt || '').slice(0,10),record.status].map(value => value ?? '')
}
export function exportBarangayExcel(groups,filterLabel) {
  const workbook = XLSX.utils.book_new()
  function addSheet(name, sections) {
    const rows = [[office],['MSWDO | Villanueva, Misamis Oriental'],['Consolidated PWD List by Barangay'],[filterLabel],[]]
    const merges = rows.slice(0,4).map((_,r) => ({s:{r,c:0},e:{r,c:8}}))
    for (const group of sections) {
      merges.push({s:{r:rows.length,c:0},e:{r:rows.length,c:8}})
      rows.push([`${group.name === 'Unassigned' ? '' : 'Barangay '}${group.name} — ${group.records.length} records`],columns)
      rows.push(...group.records.map(recordCells))
      if (!group.records.length) rows.push(['No records match the selected filters.'])
      rows.push([])
    }
    rows.push(['Total Records',sections.reduce((sum,group) => sum+group.records.length,0)])
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!merges'] = merges
    sheet['!cols'] = [6,16,23,23,22,55,20,16,14].map(wch => ({wch}))
    XLSX.utils.book_append_sheet(workbook,sheet,name)
  }
  addSheet('All Barangays',groups)
  for (const group of groups) addSheet(group.name,[group])
  return new Blob([XLSX.write(workbook,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}
export function exportBarangayPdf(groups,filterLabel) {
  const pdf = new jsPDF({orientation:'landscape',format:'a4'})
  const widths = [10,24,32,32,30,60,30,25,30]
  const left=12, bottom=194
  let first=true, y=0
  function pageHeader(group,continued=false) {
    if (!first) pdf.addPage()
    first=false
    pdf.setFont('helvetica','normal');pdf.setFontSize(8)
    pdf.text('Republic of the Philippines | Region X',148.5,12,{align:'center'})
    pdf.setFont('helvetica','bold');pdf.setFontSize(12);pdf.text(office,148.5,20,{align:'center'})
    pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.text('MSWDO | Villanueva, Misamis Oriental',148.5,26,{align:'center'})
    pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.text('Consolidated PWD List by Barangay',148.5,32,{align:'center'})
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(filterLabel,12,37)
    pdf.setFont('helvetica','bold');pdf.setFontSize(10)
    pdf.text(`${group.name === 'Unassigned' ? '' : 'Barangay '}${group.name}${continued ? ' (continued)' : ''} — ${group.records.length} records`,12,45)
    y=49
    row(columns,true)
  }
  function row(cells,heading=false,index=0) {
    pdf.setFont('helvetica',heading?'bold':'normal');pdf.setFontSize(8)
    const lines=cells.map((cell,i) => pdf.splitTextToSize(String(cell),widths[i]-4))
    const height=Math.max(9,...lines.map(value => value.length*3.6+4))
    let x=left
    pdf.setDrawColor(200,214,204)
    cells.forEach((_,i) => {
      pdf.setFillColor(...(heading ? [220,237,225] : index%2 ? [245,248,246] : [255,255,255]))
      pdf.rect(x,y,widths[i],height,'FD');pdf.setTextColor(25,45,32);pdf.text(lines[i],x+2,y+4.5);x+=widths[i]
    })
    y+=height
  }
  for (const group of groups) {
    pageHeader(group)
    if (!group.records.length) {pdf.setFont('helvetica','normal');pdf.text('No records match the selected filters.',12,y+8)}
    group.records.forEach((record,index) => {
      const cells=recordCells(record,index)
      pdf.setFont('helvetica','normal');pdf.setFontSize(8)
      const height=Math.max(9,...cells.map((cell,i) => pdf.splitTextToSize(String(cell),widths[i]-4).length*3.6+4))
      if (y+height>bottom) pageHeader(group,true)
      row(cells,false,index)
    })
  }
  const pages=pdf.getNumberOfPages()
  for (let page=1;page<=pages;page++) {pdf.setPage(page);pdf.setFontSize(8);pdf.text(`Page ${page} of ${pages}`,285,203,{align:'right'})}
  return pdf.output('blob')
}
