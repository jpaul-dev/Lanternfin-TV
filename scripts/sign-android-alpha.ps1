param(
    [Parameter(Mandatory = $true)][string]$UnsignedApk,
    [Parameter(Mandatory = $true)][string]$OutputApk,
    [string]$AndroidSdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$SigningDirectory = "$env:USERPROFILE\.lanternfin\signing"
)

# Windows-only local alpha signing. No private key or password enters GitHub CI.
$ErrorActionPreference = 'Stop'
$inputPath = (Resolve-Path -LiteralPath $UnsignedApk).Path
$outputPath = [IO.Path]::GetFullPath($OutputApk)
if ($inputPath -eq $outputPath) { throw 'Input and output must be different files.' }
if (Test-Path -LiteralPath $outputPath) { throw 'Output already exists; choose a new path.' }
$buildTools = Get-ChildItem -LiteralPath "$AndroidSdk\build-tools" -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat') } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android SDK build-tools are required.' }
$javaBin = Split-Path (Get-Command java.exe -ErrorAction Stop).Source
$keytool = Join-Path $javaBin 'keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'JDK keytool is required.' }

$keyPath = Join-Path $SigningDirectory 'lanternfin-alpha.p12'
$passwordPath = Join-Path $SigningDirectory 'alpha-password.dpapi.xml'
$keyExists = Test-Path -LiteralPath $keyPath
$passwordExists = Test-Path -LiteralPath $passwordPath
if ($keyExists -ne $passwordExists) { throw 'Incomplete signing material; recover the matching key and password.' }

New-Item -ItemType Directory -Force -Path $SigningDirectory | Out-Null
if (-not $keyExists) {
    # Limit new signing material to this Windows user and SYSTEM.
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $SigningDirectory -AclObject $acl
    $randomBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $password = ConvertTo-SecureString -String ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
    $password | Export-Clixml -LiteralPath $passwordPath
} else {
    $password = Import-Clixml -LiteralPath $passwordPath
}

try {
    $env:LANTERNFIN_ALPHA_KEYPASS = [Net.NetworkCredential]::new('', $password).Password
    if (-not $keyExists) {
        & $keytool -genkeypair -keystore $keyPath -storetype PKCS12 -storepass:env LANTERNFIN_ALPHA_KEYPASS -keypass:env LANTERNFIN_ALPHA_KEYPASS -alias lanternfin-alpha -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Lanternfin TV Alpha,O=Lanternfin TV'
        if ($LASTEXITCODE -ne 0) { throw 'Key generation failed.' }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $outputPath) | Out-Null
    & (Join-Path $buildTools.FullName 'zipalign.exe') -P 16 -v 4 $inputPath $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $keyPath --ks-key-alias lanternfin-alpha --ks-pass env:LANTERNFIN_ALPHA_KEYPASS --key-pass env:LANTERNFIN_ALPHA_KEYPASS $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose --print-certs $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Signature verification failed.' }
    Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
} finally {
    Remove-Item Env:LANTERNFIN_ALPHA_KEYPASS -ErrorAction SilentlyContinue
}
