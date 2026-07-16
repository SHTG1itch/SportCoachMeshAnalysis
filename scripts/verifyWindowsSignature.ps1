param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = 'Stop'

foreach ($candidate in $Path) {
  $resolved = (Resolve-Path -LiteralPath $candidate).Path
  $signature = Get-AuthenticodeSignature -LiteralPath $resolved
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Authenticode signature is not valid for '$resolved': $($signature.Status) — $($signature.StatusMessage)"
  }
  if (-not $signature.SignerCertificate) {
    throw "Authenticode signature for '$resolved' has no signer certificate."
  }
  Write-Output "Verified Authenticode signature: $resolved"
  Write-Output "Signer: $($signature.SignerCertificate.Subject)"
}
