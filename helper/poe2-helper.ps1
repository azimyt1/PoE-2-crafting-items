# PoE 2 Craft Assistant: clipboard helper for Windows.
#
# In the game hover an item and press Ctrl+Alt+C. This helper lets the craft
# assistant page read that item text automatically, so you do not need to
# switch windows or paste anything.
#
# It only answers the craft assistant page (allowed origins below) and only
# returns clipboard text that is a Path of Exile item. Nothing is sent anywhere.
# Stop it by closing this window.

param(
  [int]$Port = 47291,
  [string[]]$AllowedOrigins = @(
    'https://azimyt1.github.io',
    'http://localhost:5173', 'http://localhost:4173',
    'http://127.0.0.1:5173', 'http://127.0.0.1:4173'
  )
)

$ErrorActionPreference = 'Stop'

function Read-ItemText {
  # Test hook: read from a file instead of the clipboard.
  if ($env:POE2_HELPER_TEST_FILE) {
    if (Test-Path $env:POE2_HELPER_TEST_FILE) { return [IO.File]::ReadAllText($env:POE2_HELPER_TEST_FILE) }
    return $null
  }
  try { return Get-Clipboard -Raw } catch { return $null }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "Не удалось открыть порт $Port. Возможно, помощник уже запущен. $_"
  Read-Host 'Нажмите Enter, чтобы закрыть'
  exit 1
}

Write-Host '========================================================'
Write-Host ' Помощник PoE 2 Craft Assistant запущен.'
Write-Host ' В игре: наведите на предмет и нажмите Ctrl+Alt+C.'
Write-Host ' В приложении: вкладка «Трекер крафта», режим «Помощник».'
Write-Host ' Чтобы остановить, закройте это окно.'
Write-Host '========================================================'

$last = $null
$seq = 0
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $origin = $req.Headers['Origin']
    if ($origin) {
      if ($AllowedOrigins -notcontains $origin) {
        $res.StatusCode = 403
        continue
      }
      $res.AddHeader('Access-Control-Allow-Origin', $origin)
      $res.AddHeader('Vary', 'Origin')
      $res.AddHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      $res.AddHeader('Access-Control-Allow-Headers', '*')
      $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
    }
    if ($req.HttpMethod -eq 'OPTIONS') {
      $res.StatusCode = 204
      continue
    }
    $text = $null
    $clip = Read-ItemText
    if ($clip -and ($clip -match '^\s*(Item Class|Класс предмета):')) { $text = $clip }
    if ($text -ne $last) {
      $seq++
      $last = $text
      if ($text) { Write-Host ("{0:HH:mm:ss}  предмет скопирован" -f (Get-Date)) }
    }
    $json = @{ ok = $true; seq = $seq; text = $text } | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $res.ContentType = 'application/json; charset=utf-8'
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    Write-Host "Ошибка: $_"
  } finally {
    $res.Close()
  }
}
