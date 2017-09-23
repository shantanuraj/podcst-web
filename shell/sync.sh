#!/bin/bash

# Delete existing folder on aws
aws s3 rm "s3://static.podcst.io/$1/"

# Sync dist to AWS
aws s3 sync dist "s3://static.podcst.io/$1/"

# Echo success
echo "Synced dist in $1 mode"
