param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
for ($i = 0; $i -lt $voices.Count; $i++) {
  if ($voices.Item($i).GetDescription() -match 'Zira') { $voice.Voice = $voices.Item($i); break }
}
$voice.Rate = 2
$voice.Volume = 100
foreach ($scene in $plan.scenes) {
  foreach ($caption in $scene.captions) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    try {
      $stream.Open($caption.wav, 3, $false)
      $voice.AudioOutputStream = $stream
      [void]$voice.Speak($caption.text, 0)
    } finally { $stream.Close() }
  }
  Write-Output ('Narration generated: ' + $scene.id)
}
