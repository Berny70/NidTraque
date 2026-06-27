# deploy_nidtraque.ps1
# Dépose les fichiers directement dans le dossier NidTraque puis pushe
$DEST = "C:\Users\berna\Documents\Arduino\Michel_Lehmann\Pot_a_meche\Application_Smartphone\NidTraque"

cd $DEST
git add .
git commit -m "deploy: mise a jour VigieNid"
git push
Write-Host "Deploy termine !" -ForegroundColor Green
