# Create a 100% off Stripe promo code for Launchpad burn-in testing.
# Pulls STRIPE_SECRET_KEY from Vercel production env, creates one coupon + one
# named promotion code. Re-runnable: if the code already exists, it prints
# the existing record instead of failing.

param(
  [string]$Code = "BURNIN",
  [int]$MaxRedemptions = 25,
  [int]$DaysValid = 30
)

$ErrorActionPreference = "Stop"

Write-Host "=== pulling Stripe key from Vercel ==="
$tmp = "$env:TEMP\.env.stripe-promo"
# vercel CLI writes progress to stderr in non-TTY mode; redirect to null and
# ignore the non-zero noise.
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& vercel env pull $tmp --environment production --yes *> $null
$ErrorActionPreference = $prev
if (-not (Test-Path $tmp)) { throw "vercel env pull did not produce $tmp" }
$content = Get-Content -Raw $tmp
Remove-Item $tmp

$sk = ($content | Select-String -Pattern 'STRIPE_SECRET_KEY="?([^"\r\n]+)' |
  ForEach-Object { $_.Matches[0].Groups[1].Value })
if (-not $sk) { throw "STRIPE_SECRET_KEY not found in Vercel env" }
$mode = if ($sk.StartsWith("sk_live_")) { "LIVE" } else { "TEST" }
Write-Host "Stripe key loaded ($mode mode, len=$($sk.Length))"

$headers = @{ Authorization = "Bearer $sk" }

Write-Host ""
Write-Host "=== create coupon (100 percent off, forever) ==="
$couponBody = "percent_off=100&duration=forever&name=Launchpad+Burn-In+Free&metadata[purpose]=launchpad_burnin"
$coupon = Invoke-RestMethod -Uri "https://api.stripe.com/v1/coupons" `
  -Method Post -Headers $headers -Body $couponBody -TimeoutSec 20
Write-Host "coupon.id    = $($coupon.id)"
Write-Host "coupon.valid = $($coupon.valid)"

$expiresUnix = [int]([DateTimeOffset]::UtcNow.AddDays($DaysValid).ToUnixTimeSeconds())
$expiresHuman = (Get-Date).AddDays($DaysValid).ToString("yyyy-MM-dd")

Write-Host ""
Write-Host "=== create promotion code [$Code] (max $MaxRedemptions uses, expires $expiresHuman) ==="
$promoBody = "coupon=$($coupon.id)&code=$Code&max_redemptions=$MaxRedemptions&expires_at=$expiresUnix"
try {
  $promo = Invoke-RestMethod -Uri "https://api.stripe.com/v1/promotion_codes" `
    -Method Post -Headers $headers -Body $promoBody -TimeoutSec 20
  Write-Host "promo.id     = $($promo.id)"
  Write-Host "promo.code   = $($promo.code)"
  Write-Host "promo.active = $($promo.active)"
  Write-Host ""
  Write-Host "Use at checkout: $Code"
} catch {
  $detail = $_.ErrorDetails.Message
  if ($detail -match "already exists" -or $detail -match "must be unique") {
    Write-Host "promotion code [$Code] already exists, fetching existing record"
    $lookupUrl = "https://api.stripe.com/v1/promotion_codes?code={0}&limit=1" -f $Code
    $r = Invoke-RestMethod -Uri $lookupUrl -Headers $headers -TimeoutSec 20
    if ($r.data.Count -gt 0) {
      Write-Host "existing: $($r.data[0].id)  active=$($r.data[0].active)"
    }
  } else {
    Write-Host "promo FAIL: $($_.Exception.Message)"
    Write-Host $detail
    throw
  }
}
