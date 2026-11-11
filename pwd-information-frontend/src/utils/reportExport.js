import {jsPDF} from 'jspdf'
import * as XLSX from 'xlsx'

const groupNames = {disabilityType:'Disability Type',barangay:'Barangay',gender:'Gender',age:'Age Group',status:'Status'}
const office = 'PWD Registry and Information Management System'
const emptyMessage = 'No records match the selected dates and filters.'
const dateLabel = value => new Date(`${value}T00:00:00`).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
function reportDetails(options) {
  return [
    ['Date range',options.allDates ? 'All dates' : `${dateLabel(options.start)} - ${dateLabel(options.end)}`],
    ['Age group',options.age || 'All age groups'],
    ['Gender',options.gender || 'All genders'],
    ['Barangay',options.barangay || 'All barangays'],
    ['Disability type',options.disabilityType || 'All disability types'],
  ]
}
function generatedAt() {
  return new Date().toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (Philippine time)'
}

export function buildExcelReport(options) {
  const {group,data,total}=options
  const headers=['No.',groupNames[group] || 'Category','Record count','Percentage']
  const rows=[
    [office],['MSWDO | Villanueva, Misamis Oriental'],['PWD Statistics Summary'],
    ['Grouped by',groupNames[group] || 'Category'],['Generated',generatedAt()],[],
    ['APPLIED FILTERS'],...reportDetails(options),[],['Total matching records',total],[],headers,
  ]
  const headerRow=rows.length-1
  if(total>0 && data.length) data.forEach(([label,count],index)=>rows.push([index+1,label,count,count/total]))
  else rows.push([emptyMessage])
  const lastDataRow=rows.length-1
  rows.push(['','TOTAL',total,total>0?1:0],[],['Percentages use the total matching records. Rounded values may not sum to 100%.'])
  const sheet=XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols']=[{wch:8},{wch:58},{wch:18},{wch:18}]
  sheet['!merges']=[0,1,2,6,rows.length-1].map(r=>({s:{r,c:0},e:{r,c:3}}))
  for(const r of [3,4,7,8,9,10,11]) sheet['!merges'].push({s:{r,c:1},e:{r,c:3}})
  if(!total || !data.length) sheet['!merges'].push({s:{r:headerRow+1,c:0},e:{r:headerRow+1,c:3}})
  else sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:headerRow,c:0},e:{r:lastDataRow,c:3}})}
  for(let r=headerRow+1;r<=lastDataRow+1;r++) {
    const cell=sheet[XLSX.utils.encode_cell({r,c:3})]
    if(cell) cell.z='0.0%'
  }
  sheet['!rows']=rows.map((_,index)=>({hpt:index===0?30:index===2?26:21}))
  const workbook=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook,sheet,'Statistics Summary')
  return new Blob([XLSX.write(workbook,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}

export function buildPdfReport(options) {
  const {group,data,total}=options
  const pdf=new jsPDF({format:'a4'})
  const left=16,right=194,width=178,bottom=275
  let y
  function pageHeader(continued=false) {
    pdf.setTextColor(23,49,38)
    pdf.setFont('helvetica','bold');pdf.setFontSize(11)
    pdf.text(office,105,18,{align:'center'})
    pdf.setFont('helvetica','normal');pdf.setFontSize(9)
    pdf.text('MSWDO | Villanueva, Misamis Oriental',105,24,{align:'center'})
    pdf.setDrawColor(17,134,71);pdf.line(left,29,right,29)
    pdf.setFont('helvetica','bold');pdf.setFontSize(15)
    pdf.text(`PWD Statistics Summary${continued?' (continued)':''}`,left,39)
    pdf.setFont('helvetica','normal');pdf.setFontSize(9)
    pdf.text(`Grouped by: ${groupNames[group] || 'Category'}`,left,46)
    y=54
  }
  function tableHeader() {
    pdf.setFillColor(17,134,71);pdf.rect(left,y,width,10,'F')
    pdf.setTextColor(255,255,255);pdf.setFont('helvetica','bold');pdf.setFontSize(9)
    pdf.text('No.',left+3,y+6.5)
    pdf.text(groupNames[group] || 'Category',left+16,y+6.5)
    pdf.text('Records',159,y+6.5,{align:'right'})
    pdf.text('Percent',right-3,y+6.5,{align:'right'})
    y+=10;pdf.setTextColor(23,49,38)
  }
  function ensureSpace(height) {
    if(y+height>bottom){pdf.addPage();pageHeader(true);tableHeader()}
  }
  pageHeader()
  pdf.setFontSize(8);pdf.text(`Generated: ${generatedAt()}`,left,y);y+=9
  pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.text('Applied filters',left,y);y+=7
  for(const [label,value] of reportDetails(options)) {
    pdf.setFontSize(9);pdf.setFont('helvetica','bold');pdf.text(label+':',left,y)
    pdf.setFont('helvetica','normal')
    const lines=pdf.splitTextToSize(value,width-38)
    pdf.text(lines,left+38,y);y+=Math.max(6,lines.length*4.5+2)
  }
  y+=3
  pdf.setFillColor(234,248,239);pdf.rect(left,y,width,12,'F')
  pdf.setFont('helvetica','bold');pdf.setFontSize(11)
  pdf.text('Total matching records',left+4,y+8)
  pdf.text(total.toLocaleString(),right-4,y+8,{align:'right'});y+=19
  tableHeader()
  if(total>0 && data.length) {
    data.forEach(([label,count],index)=>{
      pdf.setFont('helvetica','normal');pdf.setFontSize(9)
      const lines=pdf.splitTextToSize(String(label),102)
      const height=Math.max(11,lines.length*4.5+6)
      ensureSpace(height)
      pdf.setFillColor(...(index%2?[244,248,245]:[255,255,255]));pdf.rect(left,y,width,height,'F')
      pdf.setDrawColor(219,230,222);pdf.line(left,y+height,right,y+height)
      pdf.text(String(index+1),left+3,y+7)
      pdf.text(lines,left+16,y+7)
      pdf.text(count.toLocaleString(),159,y+7,{align:'right'})
      pdf.text(`${(count/total*100).toFixed(1)}%`,right-3,y+7,{align:'right'})
      y+=height
    })
  } else {
    pdf.setFillColor(246,248,246);pdf.rect(left,y,width,18,'F')
    pdf.setFont('helvetica','normal');pdf.setFontSize(10)
    pdf.text(emptyMessage,105,y+11,{align:'center'});y+=18
  }
  ensureSpace(14)
  pdf.setFillColor(234,248,239);pdf.rect(left,y,width,12,'F')
  pdf.setFont('helvetica','bold');pdf.setFontSize(10)
  pdf.text('TOTAL',left+16,y+8);pdf.text(total.toLocaleString(),159,y+8,{align:'right'})
  pdf.text(total>0?'100.0%':'0.0%',right-3,y+8,{align:'right'});y+=19
  if(y+10>bottom){pdf.addPage();pageHeader(true)}
  pdf.setFont('helvetica','normal');pdf.setFontSize(8)
  pdf.text(pdf.splitTextToSize('Percentages use the total matching records. Rounded values may not sum to 100%.',width),left,y)
  const pages=pdf.getNumberOfPages()
  for(let page=1;page<=pages;page++) {
    pdf.setPage(page);pdf.setDrawColor(219,230,222);pdf.line(left,282,right,282)
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(90,110,98)
    pdf.text('PWD Statistics Summary',left,288)
    pdf.text(`Page ${page} of ${pages}`,right,288,{align:'right'})
  }
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
