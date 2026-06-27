# deploy_nidtraque.ps1
$DEST = "C:\Users\berna\Documents\Arduino\Michel_Lehmann\Pot_a_meche\Application_Smartphone\NidTraque"

if (Test-Path "$DEST\index_new.html") {
  Move-Item "$DEST\index_new.html" "$DEST\index.html" -Force
  Write-Host "index_new.html -> index.html" -ForegroundColor Cyan
} elseif (Test-Path "$DEST\index.html") {
  Write-Host "index.html deja en place" -ForegroundColor Yellow
} else {
  Write-Host "Aucun fichier index trouve" -ForegroundColor Red
  exit
}

cd $DEST
git add index.html
git commit -m "deploy: mise a jour VigieNid"
git push
Write-Host "Deploy termine !" -ForegroundColor Green
