# oauth_crm_token_exchange.ps1
#
# One-time exchange: Zoho CRM grant token -> permanent refresh token.
# Same lesson as Zoho Books: the grant token expires in ~10 minutes, so this
# must run INLINE right after you generate it in the API Console -- do not
# save the grant token to a file and come back to it later.
#
# USAGE (run in PowerShell, not cmd.exe):
#   .\oauth_crm_token_exchange.ps1 -ClientId "1000.XXXX" -ClientSecret "xxxx" -GrantToken "1000.xxxx.xxxx"
#
# Get ClientId / ClientSecret from the Self Client you create in step 2.
# Get GrantToken from step 4 (the "Generate" button output).

param(
    [Parameter(Mandatory=$true)][string]$ClientId,
    [Parameter(Mandatory=$true)][string]$ClientSecret,
    [Parameter(Mandatory=$true)][string]$GrantToken
)

# Defensive: strip any invisible leading/trailing whitespace picked up
# from a manual copy-paste out of the Zoho modal (drag-select can grab
# trailing spaces or wrapped-line characters that look invisible but
# make the code string not match what Zoho has on file).
$ClientId = $ClientId.Trim()
$ClientSecret = $ClientSecret.Trim()
$GrantToken = $GrantToken.Trim()

Write-Host "Grant token length: $($GrantToken.Length) characters"
Write-Host "Grant token (repr-style, showing exact boundaries): [$GrantToken]"

Write-Host "Exchanging grant token for refresh token (India datacenter: accounts.zoho.in)..."

try {
    $response = Invoke-WebRequest -Uri "https://accounts.zoho.in/oauth/v2/token" -Method Post -Body @{
        grant_type    = "authorization_code"
        client_id     = $ClientId
        client_secret = $ClientSecret
        code          = $GrantToken
    }
}
catch {
    Write-Host "Token exchange failed. If this says 'invalid_code', the grant token" -ForegroundColor Red
    Write-Host "already expired (10 min window) -- generate a fresh one and re-run immediately." -ForegroundColor Red
    throw
}

$json = $response.Content | ConvertFrom-Json

if (-not $json.refresh_token) {
    Write-Host "No refresh_token in response -- check the raw output below:" -ForegroundColor Red
    Write-Host $response.Content
    exit 1
}

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "Access Token  (expires ~1hr): $($json.access_token)"
Write-Host "Refresh Token (permanent):    $($json.refresh_token)"
Write-Host ""
Write-Host "Add these to cfo_tower/.env, alongside your existing ZOHO_* Books vars:"
Write-Host "  ZOHO_CRM_CLIENT_ID=$ClientId"
Write-Host "  ZOHO_CRM_CLIENT_SECRET=$ClientSecret"
Write-Host "  ZOHO_CRM_REFRESH_TOKEN=$($json.refresh_token)"
Write-Host "  ZOHO_CRM_API_BASE=https://www.zohoapis.in/crm/v6"
Write-Host ""
Write-Host "Your existing ZOHO_ACCOUNTS_URL var is reused as-is -- accounts.zoho.in"
Write-Host "is shared between Books and CRM, only the API base and credentials differ."
Write-Host ""
Write-Host "This refresh token will not be shown again in this form -- save it now."