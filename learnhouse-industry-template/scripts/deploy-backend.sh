#!/bin/bash
set -e
gcloud builds submit --config cloudbuild.yaml
