#!bash
export SERVICES_LIST="$(nx affected:apps --plain)"
services=($TEST_ENV) 
for i in "${services[@]}"; do npm run build:"$i"; done
echo "$SERVICES_LIST"