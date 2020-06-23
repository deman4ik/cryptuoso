#!bash
export SERVICES_LIST="$(nx affected:apps --plain --base=$(git rev-parse HEAD~1))"
services=($SERVICES_LIST) 
for i in "${services[@]}"; do echo "$i"; done
echo "$SERVICES_LIST"