# deploy_nidtraque.ps1
# Usage : lancez ce script apres avoir telecharge index.html depuis Claude

$DEST = "C:\Users\berna\Documents\Arduino\Michel_Lehmann\Pot_a_meche\Application_Smartphone\NidTraque"
$DL   = "$env:USERPROFILE\Downloads"

# 1. Copier index.html si present dans Downloads
if (Test-Path "$DL\index.html") {
  Copy-Item "$DL\index.html" "$DEST\index.html" -Force
  Write-Host "index.html copie" -ForegroundColor Cyan
} else {
  Write-Host "Pas de nouveau index.html dans Downloads - push version existante" -ForegroundColor Yellow
}

# 2. Git push
cd $DEST
git add .
git commit -m "deploy: mise a jour VigieNid"
git push

Write-Host "Deploy termine !" -ForegroundColor Green
