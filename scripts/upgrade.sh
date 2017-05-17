#!/bin/bash

if [ -z "$1" ]
  then
    echo "No argument supplied"
    exit -1
fi

echo "$1"

for dir in ./packages/*; do (cd "$dir" && echo "" && echo "$dir" && yarn upgrade $1); done