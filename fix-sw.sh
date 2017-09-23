#!/bin/bash

# Rewrite sw-cache.js
sed -i -- "s/https:\/\/static.podcst.io\/$1\/index.html/https:\/\/play.podcst.io\/index.html/g" dist/sw.js

# Echo success
echo "Fixed dist/sw.js for $1"
