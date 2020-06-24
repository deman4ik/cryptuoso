#!bash
base=$(git rev-list -n 1 $(git tag | tail -1)) 
echo "nx affected:apps --plain --base=$base"
SERVICES_LIST=$(nx affected:apps --plain --base=$base)
echo "$SERVICES_LIST"
services=($SERVICES_LIST) 
for i in "${services[@]}"; do echo "$i"; done
