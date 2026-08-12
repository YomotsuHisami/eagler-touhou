param([int]$Port = 8130)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$root = [IO.Path]::GetFullPath((Join-Path $project '..'))
$prefix = "http://127.0.0.1:$Port/"
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.wasm'='application/wasm'; '.data'='application/octet-stream'; '.ogg'='audio/ogg'; '.wav'='audio/wav' }
$server = [Net.HttpListener]::new(); $server.Prefixes.Add($prefix); $server.Start()
Write-Host "eagler-touhou: ${prefix}eagler-touhou/"
try {
  while ($server.IsListening) {
    $context = $server.GetContext()
    try {
      $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
      if (-not $relative) { $relative = 'eagler-touhou/index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
      if (-not $file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid path' }
      if ([IO.Directory]::Exists($file)) { $file = Join-Path $file 'index.html' }
      if (-not [IO.File]::Exists($file)) { throw 'Not found' }
      $info = [IO.FileInfo]$file; $context.Response.StatusCode = 200; $context.Response.ContentLength64 = $info.Length
      $extension = $info.Extension.ToLowerInvariant(); $context.Response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
      $stream = $info.OpenRead(); try { $stream.CopyTo($context.Response.OutputStream) } finally { $stream.Dispose() }
    } catch {
      try { $context.Response.StatusCode = 404 } catch { }
    } finally { $context.Response.Close() }
  }
} finally { $server.Stop(); $server.Close() }
