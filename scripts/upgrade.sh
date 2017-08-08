#!/bin/bash

for dir in ./packages/*; do (cd "$dir" && echo "" && echo "$dir" && yarn upgrade); done
