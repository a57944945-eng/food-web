param(
  [string]$WorkbookPath = ".\food-data.xlsx",
  [string]$OutputPath = ".\data\restaurants.json"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-Entry([System.IO.Compression.ZipArchive]$Zip, [string]$Name) {
  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { return $null }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

function Read-XlsxRows([string]$Path) {
  $copyPath = Join-Path $env:TEMP ("food-data-" + [guid]::NewGuid().ToString() + ".xlsx")
  $inputStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $outputStream = [System.IO.File]::Open($copyPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Close(); $inputStream.Close() }

  $zip = [System.IO.Compression.ZipFile]::OpenRead($copyPath)
  try {
    $strings = @()
    $sharedStringsXml = Read-Entry $zip "xl/sharedStrings.xml"
    if ($sharedStringsXml) {
      [xml]$sharedStrings = $sharedStringsXml
      foreach ($item in $sharedStrings.sst.si) {
        $texts = @()
        foreach ($node in $item.SelectNodes('.//*[local-name()="t"]')) { $texts += $node.InnerText }
        $strings += ($texts -join "")
      }
    }

    [xml]$sheet = Read-Entry $zip "xl/worksheets/sheet1.xml"
    $rows = @()
    foreach ($row in $sheet.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')) {
      $cells = [ordered]@{}
      foreach ($cell in $row.SelectNodes('*[local-name()="c"]')) {
        $column = ([string]$cell.r -replace '\d', '')
        $valueNode = $cell.SelectSingleNode('*[local-name()="v"]')
        $inlineNode = $cell.SelectSingleNode('*[local-name()="is"]/*[local-name()="t"]')
        $value = if ($inlineNode) { $inlineNode.InnerText } elseif ($valueNode) { $valueNode.InnerText } else { "" }
        if ($cell.t -eq "s" -and $value -ne "") { $value = $strings[[int]$value] }
        $cells[$column] = $value
      }
      $rows += [pscustomobject]$cells
    }
    return $rows
  } finally {
    $zip.Dispose()
    Remove-Item -LiteralPath $copyPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-Cell($Row, [string]$Column) {
  if ($Row.PSObject.Properties.Name -contains $Column) { return [string]$Row.$Column }
  return ""
}

function Convert-ExcelDate($Value) {
  if (-not $Value) { return "" }
  $number = 0.0
  if ([double]::TryParse($Value, [ref]$number)) {
    return ([datetime]"1899-12-30").AddDays($number).ToString("yyyy-MM-dd")
  }
  return $Value
}

function Convert-Hours($Value) {
  if (-not $Value) { return @() }
  if ($Value -match '^(Closed|休|公休)$') { return @() }
  $normalized = $Value.Replace([char]0xFF0C, ",").Replace([char]0x3001, ",")
  return ($normalized -split '[;,]') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$rows = Read-XlsxRows $WorkbookPath
$restaurants = @()
$rowNumber = 0

foreach ($row in $rows | Select-Object -Skip 1) {
  $rowNumber++
  $name = Get-Cell $row "B"
  if (-not $name) { continue }

  $latText = Get-Cell $row "F"
  $lngText = Get-Cell $row "G"
  $lat = $null
  $lng = $null
  if ($latText) { $lat = [double]$latText }
  if ($lngText) { $lng = [double]$lngText }

  $openingHours = [ordered]@{
    monday = @(Convert-Hours (Get-Cell $row "L"))
    tuesday = @(Convert-Hours (Get-Cell $row "M"))
    wednesday = @(Convert-Hours (Get-Cell $row "N"))
    thursday = @(Convert-Hours (Get-Cell $row "O"))
    friday = @(Convert-Hours (Get-Cell $row "P"))
    saturday = @(Convert-Hours (Get-Cell $row "Q"))
    sunday = @(Convert-Hours (Get-Cell $row "R"))
  }

  $issues = @()
  if (-not (Get-Cell $row "E")) { $issues += "missing_precise_address" }
  if ($null -eq $lat -or $null -eq $lng) { $issues += "missing_coordinates" }
  if (($openingHours.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum -eq 0) { $issues += "missing_opening_hours" }

  $restaurants += [pscustomobject][ordered]@{
    id = if (Get-Cell $row "A") { Get-Cell $row "A" } else { $rowNumber }
    name = $name
    region = ((Get-Cell $row "C"), (Get-Cell $row "D") | Where-Object { $_ }) -join ""
    city = Get-Cell $row "C"
    district = Get-Cell $row "D"
    address = Get-Cell $row "E"
    latitude = $lat
    longitude = $lng
    mapUrl = Get-Cell $row "H"
    category = Get-Cell $row "I"
    recommended = Get-Cell $row "J"
    notes = Get-Cell $row "K"
    openingHours = $openingHours
    closedNote = Get-Cell $row "S"
    source = Get-Cell $row "T"
    sourceUrl = Get-Cell $row "U"
    dataStatus = Get-Cell $row "V"
    lastVerified = Convert-ExcelDate (Get-Cell $row "W")
    dataIssues = $issues
  }
}

$payload = [ordered]@{
  generatedFrom = (Resolve-Path -LiteralPath $WorkbookPath).Path
  generatedAt = (Get-Date).ToString("s")
  schemaVersion = 2
  restaurants = $restaurants
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
$json = $payload | ConvertTo-Json -Depth 8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($OutputPath, $json, $utf8NoBom)
Write-Output "Synced $($restaurants.Count) restaurants to $OutputPath"
