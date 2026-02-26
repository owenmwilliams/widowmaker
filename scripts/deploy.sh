#!/bin/bash

# MoveTrack GCP Deployment Script
# This script helps you deploy MoveTrack to Google Cloud Platform

set -e

echo "======================================"
echo "MoveTrack GCP Deployment Helper"
echo "======================================"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed."
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get or set project ID
if [ -z "$PROJECT_ID" ]; then
    echo "Enter your GCP Project ID:"
    read PROJECT_ID
    export PROJECT_ID
fi

echo "Using Project ID: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Menu
echo ""
echo "What would you like to do?"
echo "1) Enable required GCP APIs"
echo "2) Create Cloud SQL PostgreSQL instance"
echo "3) Run database migrations"
echo "4) Store secrets in Secret Manager"
echo "5) Deploy to Cloud Run (manual)"
echo "6) Set up Cloud Build trigger"
echo "7) Exit"
echo ""
echo "Enter your choice (1-7):"
read choice

case $choice in
    1)
        echo "Enabling required APIs..."
        gcloud services enable cloudbuild.googleapis.com
        gcloud services enable run.googleapis.com
        gcloud services enable sqladmin.googleapis.com
        gcloud services enable secretmanager.googleapis.com
        gcloud services enable containerregistry.googleapis.com
        echo "APIs enabled successfully!"
        ;;
    2)
        echo "Creating Cloud SQL instance..."
        echo "Enter root password for PostgreSQL:"
        read -s ROOT_PASSWORD

        gcloud sql instances create movetrack-db \
          --database-version=POSTGRES_15 \
          --tier=db-f1-micro \
          --region=us-central1 \
          --root-password=$ROOT_PASSWORD

        echo "Creating database..."
        gcloud sql databases create movetrack_db --instance=movetrack-db

        echo "Enter password for movetrack_user:"
        read -s USER_PASSWORD

        gcloud sql users create movetrack_user \
          --instance=movetrack-db \
          --password=$USER_PASSWORD

        echo ""
        echo "Cloud SQL instance created successfully!"
        echo "Connection name:"
        gcloud sql instances describe movetrack-db --format="value(connectionName)"
        ;;
    3)
        echo "Running database migrations..."
        echo "Enter Cloud SQL connection name (e.g., project:region:instance):"
        read CONNECTION_NAME

        echo "Starting Cloud SQL Proxy..."
        cloud_sql_proxy -instances=$CONNECTION_NAME=tcp:5432 &
        PROXY_PID=$!

        sleep 5

        echo "Enter database password:"
        read -s DB_PASSWORD

        cd movetrack-api
        MT_DATALAYER_HOSTNAME=localhost \
        MT_DATALAYER_PORT=5432 \
        MT_DATALAYER_DATABASE=movetrack_db \
        MT_DATALAYER_USERNAME=movetrack_user \
        MT_DATALAYER_PASSWORD=$DB_PASSWORD \
        node bin/migrate.js

        kill $PROXY_PID
        cd ..
        echo "Migrations completed!"
        ;;
    4)
        echo "Storing secrets in Secret Manager..."

        echo "Enter database password:"
        read -s DB_PASSWORD
        echo -n "$DB_PASSWORD" | gcloud secrets create movetrack-db-password \
          --data-file=- --replication-policy="automatic" 2>/dev/null || \
          echo -n "$DB_PASSWORD" | gcloud secrets versions add movetrack-db-password --data-file=-

        echo "Generating JWT secret..."
        JWT_SECRET=$(openssl rand -base64 32)
        echo -n "$JWT_SECRET" | gcloud secrets create movetrack-jwt-secret \
          --data-file=- --replication-policy="automatic" 2>/dev/null || \
          echo -n "$JWT_SECRET" | gcloud secrets versions add movetrack-jwt-secret --data-file=-

        echo "Enter SendGrid API key:"
        read -s SENDGRID_KEY
        echo -n "$SENDGRID_KEY" | gcloud secrets create sendgrid-api-key \
          --data-file=- --replication-policy="automatic" 2>/dev/null || \
          echo -n "$SENDGRID_KEY" | gcloud secrets versions add sendgrid-api-key --data-file=-

        # Grant Cloud Run access to secrets
        PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
        gcloud projects add-iam-policy-binding $PROJECT_ID \
          --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
          --role="roles/secretmanager.secretAccessor"

        echo "Secrets stored successfully!"
        ;;
    5)
        echo "Deploying to Cloud Run manually..."
        gcloud builds submit --config=cloudbuild.yaml
        echo "Deployment complete!"
        echo ""
        echo "Frontend URL:"
        gcloud run services describe movetrack-app --region=us-central1 --format="value(status.url)"
        echo ""
        echo "API URL:"
        gcloud run services describe movetrack-api --region=us-central1 --format="value(status.url)"
        ;;
    6)
        echo "Setting up Cloud Build trigger..."
        echo "Please visit: https://console.cloud.google.com/cloud-build/triggers"
        echo "And follow the instructions in docs/generated/readmes/DEPLOYMENT.md"
        ;;
    7)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "Done! For more details, see docs/generated/readmes/DEPLOYMENT.md"
