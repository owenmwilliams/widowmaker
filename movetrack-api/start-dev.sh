#!/bin/bash

# MoveTrack API Development Server
# This script starts the API with all necessary environment variables

export NODE_ENV=development
export MT_DATALAYER_HOSTNAME=localhost
export MT_DATALAYER_PORT=5432
export MT_DATALAYER_DATABASE=movetrack_db
export MT_DATALAYER_USERNAME=movetrack_user
export MT_DATALAYER_PASSWORD=changeme123
export PORT=3050

echo "Starting MoveTrack API in development mode..."
echo "Magic links will be logged to this console"
echo "Press Ctrl+C to stop"
echo ""

npm start
