$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$api = 'http://localhost:8081/api/records'
$output = Join-Path $PSScriptRoot '../demo-documents/first-100'
New-Item -ItemType Directory -Force $output | Out-Null
$allRecords = Invoke-RestMethod $api -TimeoutSec 30
$records = @($allRecords | Where-Object { $_.pwdId -match '^PWD-\d{4}$' -and [int]$_.pwdId.Substring(4) -ge 1 -and [int]$_.pwdId.Substring(4) -le 100 } | Sort-Object pwdId)
if ($records.Count -ne 100) { throw "Expected 100 records, found $($records.Count)." }
$backup = @{}
foreach ($record in $records) {
  $backup[$record.pwdId] = Invoke-RestMethod "$api/$($record.pwdId)/document-photos" -TimeoutSec 15
}
$backupPath = Join-Path $output ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$backup | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding utf8 $backupPath
$green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(22,100,70))
$ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30,45,40))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(100,115,105))
$blue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(35,65,155))
$titleFont = [System.Drawing.Font]::new('Arial',24,[System.Drawing.FontStyle]::Bold)
$bodyFont = [System.Drawing.Font]::new('Arial',18)
$smallFont = [System.Drawing.Font]::new('Arial',13)
$signatureFont = [System.Drawing.Font]::new('Segoe Script',28,[System.Drawing.FontStyle]::Italic)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
function Draw-Text($text, $font, $brush, $x, $y, $width, $height) {
  $g.DrawString([string]$text,$font,$brush,[System.Drawing.RectangleF]::new($x,$y,$width,$height))
}
try {
  foreach ($record in $records) {
    $name = (@($record.firstName,$record.middleName,$record.lastName) | Where-Object { $_ }) -join ' '
    foreach ($field in @('proofOfDisability','pwdIdPhoto')) {
      $proof = $field -eq 'proofOfDisability'
      $width = 1000; $height = if ($proof) {1250} else {650}
      $bitmap = [System.Drawing.Bitmap]::new($width,$height)
      $g = [System.Drawing.Graphics]::FromImage($bitmap)
      $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
      $g.Clear([System.Drawing.Color]::White)
      $g.FillRectangle($green,0,0,$width,105)
      Draw-Text 'SAMPLE - FOR DEMONSTRATION ONLY' $titleFont ([System.Drawing.Brushes]::White) 32 33 940 55
      if ($proof) {
        Draw-Text 'PROOF OF DISABILITY' $titleFont $green 60 145 880 60
        Draw-Text 'Fictional Community Clinic | Sample certificate' $smallFont $muted 60 210 880 50
        Draw-Text ('Patient: ' + $name) $bodyFont $ink 60 300 880 90
        Draw-Text ('Record: ' + $record.pwdId) $bodyFont $ink 60 400 880 50
        Draw-Text ('Disability type: ' + $record.disabilityType) $bodyFont $ink 60 475 880 120
        Draw-Text 'This sample illustrates the supporting document submitted with a PWD registry record. The details shown are for demonstration purposes only.' $bodyFont $ink 60 625 880 160
        Draw-Text 'No medical examination or clinical certification is represented by this sample.' $bodyFont $muted 60 800 880 100
        Draw-Text 'Elena Santos' $signatureFont $blue 60 950 700 75
        Draw-Text 'Dr. Elena Santos - Fictional Physician' $bodyFont $ink 60 1030 880 50
        Draw-Text 'Illustrative physician signature only' $smallFont $muted 60 1080 880 45
      } else {
        Draw-Text 'DEMO PWD IDENTIFICATION CARD' $titleFont $green 35 130 940 60
        if ($record.photo -match '^data:image/[^;]+;base64,(.+)$') {
          $stream = [System.IO.MemoryStream]::new([Convert]::FromBase64String($Matches[1]))
          $portrait = [System.Drawing.Image]::FromStream($stream)
          $g.DrawImage($portrait,[System.Drawing.Rectangle]::new(35,220,210,250))
          $portrait.Dispose(); $stream.Dispose()
        }
        Draw-Text $name $titleFont $ink 280 220 680 100
        Draw-Text $record.pwdId $bodyFont $green 280 325 650 50
        Draw-Text $record.disabilityType $bodyFont $ink 280 385 680 80
        Draw-Text ($record.barangay + ', Villanueva, Misamis Oriental') $smallFont $muted 280 475 680 65
      }
      $g.FillRectangle($green,0,($height-75),$width,75)
      Draw-Text 'SAMPLE ONLY - NOT VALID FOR OFFICIAL OR MEDICAL USE' $smallFont ([System.Drawing.Brushes]::White) 32 ($height-49) 950 45
      $g.Dispose()
      $path = Join-Path $output ($record.pwdId + '-' + $field + '.jpg')
      $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
      $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality,[long]85)
      $bitmap.Save($path,$codec,$parameters); $bitmap.Dispose(); $parameters.Dispose()
      $bytes = [System.IO.File]::ReadAllBytes($path)
      if ($bytes.Length -gt 400000) { throw "Image too large: $path" }
    }
  }
  Write-Output 'Generated 200 sample images; uploading to the 100 target records.'
  foreach ($record in $records) {
    foreach ($field in @('proofOfDisability','pwdIdPhoto')) {
      $bytes = [System.IO.File]::ReadAllBytes((Join-Path $output ($record.pwdId + '-' + $field + '.jpg')))
      $image = 'data:image/jpeg;base64,' + [Convert]::ToBase64String($bytes)
      $body = @{image=$image} | ConvertTo-Json -Compress
      $saved = Invoke-RestMethod "$api/$($record.pwdId)/document-photos/$field" -Method Patch -ContentType 'application/json' -Body $body -TimeoutSec 20
      if ($saved.$field -cne $image) { throw "Upload verification failed: $($record.pwdId) $field" }
    }
  }
  $verified = 0
  foreach ($record in $records) {
    $saved = Invoke-RestMethod "$api/$($record.pwdId)/document-photos" -TimeoutSec 15
    foreach ($field in @('proofOfDisability','pwdIdPhoto')) {
      $expected = 'data:image/jpeg;base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $output ($record.pwdId + '-' + $field + '.jpg'))))
      if ($saved.$field -cne $expected) { throw "Readback verification failed: $($record.pwdId) $field" }
    }
    $verified++
  }
  Write-Output "Verified both document photos for $verified records. Backup: $backupPath"
} finally {
  foreach ($resource in @($green,$ink,$muted,$blue,$titleFont,$bodyFont,$smallFont,$signatureFont)) { $resource.Dispose() }
}
