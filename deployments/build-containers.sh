#!bash
services=(${{ steps.services.outputs.list }})
for i in "${services[@]}"; do docker build --build-arg GITHUB_SSH_KEY="${{ secrets.GITHUB_SSH_KEY }}" -t registry.digitalocean.com/cpz/$i:$(echo $GITHUB_SHA | head -c7) .; done 
