# Signs the Microsoft Store CLI (msstore) in to Partner Center with the
# repository's Partner Center API secrets, passed as TENANT_ID, CLIENT_ID,
# CLIENT_SECRET and SELLER_ID (README → Microsoft Store).
foreach ($name in 'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SELLER_ID') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "The secret for $name is not set (README → Microsoft Store)" }
}
msstore reconfigure --tenantId $env:TENANT_ID --sellerId $env:SELLER_ID --clientId $env:CLIENT_ID --clientSecret $env:CLIENT_SECRET
if ($LASTEXITCODE) { throw "msstore reconfigure failed ($LASTEXITCODE)" }
