#!bash
SERVICES_LIST=$(node ./node_modules/@nrwl/cli/bin/nx.js affected:apps --plain --all  )
echo "$SERVICES_LIST"
services=($SERVICES_LIST) 
for i in "${services[@]}"; do echo "$i"; done
