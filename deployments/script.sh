#!bash
export SERVICES_LIST="$(nx affected:apps --plain)"
services=($SERVICES_LIST) 
for i in "${services[@]}"; do echo "$i"; done
echo "$SERVICES_LIST"