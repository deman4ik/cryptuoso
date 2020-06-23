#!bash
export SERVICES_LIST="$(nx affected:apps --plain --base=master~1 --head=origin/master)"
services=($SERVICES_LIST) 
for i in "${services[@]}"; do echo "$i"; done
echo "$SERVICES_LIST"