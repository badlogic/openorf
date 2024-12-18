#!/bin/bash
set -e
npm run build
host=slayer.marioslab.io
host_dir=/home/badlogic/openorf.mariozechner.at


rsync -avz --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

if [ "$1" == "server" ]; then
    echo "Publishing client & server"
    ssh -t $host "export OPENORF_DB=$OPENORF_DB && export OPENORF_DB_USER=$OPENORF_DB_USER && export OPENORF_DB_PASSWORD=$OPENORF_DB_PASSWORD && cd $host_dir && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
else
    echo "Publishing client only"
fi