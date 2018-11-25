#!/bin/bash

# Fallback if bucket not specified
BUCKET=${BUCKET_URL-static.podcst.io}

# Delete existing folder on aws
aws s3 rm "s3://$BUCKET/$1/"

# Sync dist to AWS
aws s3 sync dist "s3://$BUCKET/$1/"

# Echo success
echo "Synced dist to $1"
